# privacyIDEA — instalação para produção

Guia testado a sério (não é teórico) para o provider de MFA opcional
`mfa/privacyidea.py`. **Não uses Docker para isto** — não existe imagem
oficial mantida para produção (`privacyidea/privacyidea` não existe no
Docker Hub; a única imagem oficial, `privacyidea/otpserver`, é um demo
antigo cuja própria documentação avisa para não usar em produção,
porque tem chaves de encriptação e certificado fixos). O método
suportado pelo próprio projeto é instalar via pacotes apt numa
VM/LXC Ubuntu 22.04 ou 24.04 LTS.

## 1. Criar a máquina

Qualquer VM ou LXC Ubuntu 22.04/24.04 serve, 2 vCPU / 2GB RAM chega.
Em Proxmox, um LXC é mais rápido de criar que uma VM completa:

```bash
# no host Proxmox, ajusta o ID/hostname/IP conforme o teu ambiente
pct create <ID> local:vztmpl/ubuntu-22.04-standard_22.04-1_amd64.tar.zst \
  --hostname privacyidea \
  --cores 2 --memory 2048 --swap 512 \
  --net0 name=eth0,bridge=vmbr0,gw=<GATEWAY>,ip=<IP>/24,type=veth \
  --rootfs <STORAGE>:8 \
  --unprivileged 1 --onboot 1
pct start <ID>
```

Se `ubuntu-22.04-standard...tar.zst` não estiver em cache local, baixa
primeiro em Datacenter → Storage → Templates na UI do Proxmox (ou
`pveam download local ubuntu-22.04-standard_22.04-1_amd64.tar.zst`).

## 2. Instalar o privacyIDEA (pacotes oficiais NetKnights)

Dentro da máquina, como root:

```bash
apt-get update && apt-get install -y gnupg2 apt-transport-https software-properties-common curl wget

# chave GPG oficial — confirma a fingerprint antes de confiar nela
wget https://lancelot.netknights.it/NetKnights-Release.asc
gpg --import --import-options show-only --with-fingerprint NetKnights-Release.asc
# deve mostrar: 0940 4ABB EDB3 586D EDE4 AD22 00F7 0D62 AE25 0082
mv NetKnights-Release.asc /etc/apt/trusted.gpg.d/

# repositório — troca "jammy" por "noble" em Ubuntu 24.04
add-apt-repository -y http://lancelot.netknights.it/community/jammy/stable
apt-get update

DEBIAN_FRONTEND=noninteractive apt-get install -y privacyidea-apache2
```

### Bug conhecido no pós-instalação (versão 3.13.3, jammy)

O script de pós-instalação do pacote `privacyidea-apache2` tenta matar
um processo `rngd` (usado só para gerar entropia durante a criação das
chaves) com `killall -9 rngd` sem `|| true` — se esse processo já não
existir (comum em LXC/VMs), o `apt-get install` falha com
`E: Sub-process /usr/bin/dpkg returned an error code (1)`, mesmo tendo
já escrito as chaves de encriptação e a base de dados corretamente.
Corrige e continua a instalação assim:

```bash
sed -i 's/^    killall -9 rngd$/    killall -9 rngd || true/' \
  /var/lib/dpkg/info/privacyidea-apache2.postinst
DEBIAN_FRONTEND=noninteractive dpkg --configure -a
```

Confirma que arrancou:

```bash
systemctl is-active apache2   # deve dizer "active"
curl -sk https://localhost/auth -d username=x -d password=y
# resposta esperada: {"result": {"status": false, "error": {...}}} — ou seja, respondeu
```

## 3. Criar admin, resolver e realm

```bash
pi-manage admin add fmadmin -e admin@teudominio.local -p '<password forte>'

# resolver "internal" — os utilizadores não vêm de LDAP nenhum, são
# criados automaticamente pelo Fleet Manager no primeiro enrolamento
pi-manage resolver create_internal fmresolver
pi-manage realm create fmrealm fmresolver
```

(Os avisos `DeprecationWarning: The command '...' is deprecated` são
inofensivos — os comandos continuam a funcionar nesta versão.)

Guarda o username/password do admin — vais precisar deles no passo 4.

## 3.5. Ativar push (opcional, sem Firebase)

Só é preciso se quiseres a opção de aprovação por push na app
privacyIDEA Authenticator, além do código de 6 dígitos. Duas políticas
de enrolamento, testadas a sério contra um servidor real — troca
`<URL-desta-VM>` pelo URL público desta instância (o mesmo que vais
pôr em "Server URL" no passo 4):

```bash
TOKEN=$(curl -sk https://localhost/auth -d username=fmadmin -d 'password=<password do passo 3>' \
  | python3 -c "import json,sys; print(json.load(sys.stdin)['result']['value']['token'])")

# sem isto, /token/init com type=push falha com "Missing enrollment
# policy for push token: push_registration_url"
curl -sk https://localhost/policy/push_registration_url -H "Authorization: $TOKEN" \
  -d name=push_registration_url -d scope=enrollment \
  -d "action=push_registration_url=<URL-desta-VM>/ttype/push" -d active=1

# "poll only" evita precisares de um projeto Firebase — a app vai
# buscar os pedidos pendentes ao servidor em vez de ser acordada por
# uma notificação push da Google
curl -sk https://localhost/policy/push_poll_only -H "Authorization: $TOKEN" \
  -d name=push_poll_only -d scope=enrollment \
  -d "action=push_firebase_configuration=poll only" -d active=1
```

A troca é que deixa de ser um push instantâneo — a app só mostra o
pedido quando é aberta ou quando se faz swipe para atualizar.

## 4. Ligar ao Fleet Manager

Desde a v1.1.6.0 isto faz-se pela interface, não por variáveis de
ambiente: entra no Fleet Manager como **superadmin** → **Settings** →
**MFA Providers** → cartão privacyIDEA → preenche:

| Campo | Valor |
|---|---|
| Server URL | `https://<IP-ou-hostname-da-VM>` |
| Admin User | `fmadmin` |
| Admin Password | a password do passo 3 |
| Realm | `fmrealm` |
| Resolver | `fmresolver` |

Guarda — o cartão passa a "Configurado" e qualquer utilizador já pode
ativar o privacyIDEA em Account → Security.

### Certificado self-signed

Por omissão o `privacyidea-apache2` gera um certificado self-signed.
Se não fores substituí-lo por um real (Let's Encrypt, CA interna),
tens de desligar a verificação TLS do lado do Fleet Manager — isto
**é** uma variável de ambiente (decisão de infraestrutura, não uma
credencial editável por admin), definida no `stack.env`/`.env` do
Fleet Manager:

```
PRIVACYIDEA_VERIFY_SSL=false
```

e reiniciar o container `web`. Sem isto, todas as chamadas ao
privacyIDEA falham com `SSLCertVerificationError` e o Fleet Manager
mostra "Couldn't reach privacyIDEA".

## 5. Verificar que está mesmo a funcionar

Já dentro do Fleet Manager, como um utilizador qualquer: Account →
Security → cartão privacyIDEA → escolhe "6-digit code" ou "Push
approval" → "Enable privacyIDEA" → aparece um QR → para o código,
confirma com o código do teu authenticator app; para push, digitaliza
o QR com a app privacyIDEA Authenticator e espera a confirmação
automática → faz logout/login e confirma que o passo de MFA aparece
(um pedido de push no telemóvel, ou o pedido de código, consoante o
que escolheste).

O fluxo de enrolamento e o polling de estado foram testados a sério
contra um servidor real; o passo em que a app aprova mesmo um pedido
de login (trigger_and_wait_push em mfa/privacyidea.py) foi construído
a partir da documentação oficial da API mas nunca testado com um
telemóvel real — vale a pena confirmar esse último passo.

---

## Nota importante sobre o `docker-compose.yml` de produção

Isto não é específico do privacyIDEA, mas apanhou-nos aqui: o Fleet
Manager corre em produção via um stack do Portainer, cujo
`docker-compose.yml` **é um ficheiro à parte no servidor**
(`/var/lib/docker/volumes/portainer_data/_data/compose/<N>/docker-compose.yml`),
não é o mesmo ficheiro do repositório git nem se atualiza sozinho.

Sempre que uma alteração ao código adicionar uma variável de ambiente
nova ao `docker-compose.yml` do repositório (como aconteceu com todas
as `PRIVACYIDEA_*` e `AUTH_LDAP_*`), é preciso copiar manualmente o
ficheiro atualizado para o servidor antes de fazer `docker compose up
-d`, senão a app continua a correr sem essas variáveis — sem erro
nenhum, só silenciosamente "não configurado". Para copiar:

```bash
# a partir do teu checkout local do repositório
scp docker-compose.yml root@<servidor>:/var/lib/docker/volumes/portainer_data/_data/compose/<N>/docker-compose.yml
ssh root@<servidor> "cd /var/lib/docker/volumes/portainer_data/_data/compose/<N> && \
  docker compose -p mupitech --env-file stack.env pull && \
  docker compose -p mupitech --env-file stack.env up -d"
```

Vale a pena confirmar sempre com um `diff` antes de sobrescrever, caso
alguém tenha alterado o ficheiro do servidor diretamente.

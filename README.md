<p align="center">
  <img src="Logo.svg" alt="MupiTech Fleet Manager" width="600">
</p>

<p align="center">
  Painel de gestão para redes de mupis digitais baseados em <a href="https://github.com/Screenly/Anthias">Anthias</a>.<br>
  Controlo centralizado de todo o parque de ecrãs Raspberry Pi a partir de uma única interface.
</p>

![Dashboard](screenshots/dashboard.png)

## Sobre o projeto

O **MupiTech Fleet Manager** é um fork do "Anthias Fleet Manager", adaptado e traduzido para uso interno em redes municipais de sinalização digital (mupis). Mantém total compatibilidade com o protocolo do [Anthias](https://github.com/Screenly/Anthias) — o software open-source que corre em cada dispositivo Raspberry Pi — e comunica com os players através da respetiva API HTTP.

Os dispositivos correm atualmente uma imagem de um fork do Anthias com funcionalidades adicionais (registo de reprodução, capturas de ecrã, agendamento por faixas horárias, CEC e infravermelhos) que ainda não existem na versão oficial. Os detalhes desta análise, incluindo o que seria perdido ao migrar para as imagens oficiais, estão documentados em [docs/anthias-version-analysis.md](docs/anthias-version-analysis.md). A origem e a tag das imagens usadas no provisionamento dos dispositivos são configuráveis por variável de ambiente, para facilitar uma futura migração.

## Funcionalidades

### Gestão de dispositivos
Monitorização em tempo real de todos os players: estado online/offline, utilização de CPU/disco, avisos de throttling e capturas de ecrã ao vivo (incluindo vídeo). Suporta rotação remota do ecrã (0°/90°/180°/270°), individualmente ou em massa por grupo.

![Players](screenshots/players.png)

### Biblioteca de conteúdos
Carregamento de imagens, vídeos e páginas web. Organização em pastas, filtragem por tipo e implementação num único clique.

![Content](screenshots/content.png)

### Agendamento
Agendas de reprodução flexíveis por dispositivo:
- **Faixa por omissão** — reproduz quando não há mais nada agendado
- **Faixas horárias** — reproduz em horas e dias específicos
- **Eventos** — pontuais ou recorrentes, com prioridade máxima

Linha do tempo visual com a agenda completa.

![Schedule](screenshots/schedule.png)

### Playlists
Conjuntos de conteúdos que podem ser aplicados diretamente a dispositivos, grupos ou localizações, sem necessidade de configurar cada player individualmente.

### Localizações e grupos
Organização hierárquica do parque: localizações físicas (ex. edifícios, freguesias), com grupos de dispositivos dentro de cada uma, ou equipamentos avulsos sem grupo. Grupos com cor identificativa para facilitar a gestão visual.

### Videovigilância (CCTV)
Funcionalidade opcional (ativada por variável de ambiente) que integra câmaras RTSP na página de conteúdos, convertendo o stream para mosaico ou rotação visualizáveis no navegador via ffmpeg.

![CCTV](screenshots/cctv.png)

### Implementação remota
Envio de conteúdo para um ou vários dispositivos em simultâneo, com acompanhamento do progresso em tempo real.

### Histórico de reprodução
Registo do que foi reproduzido em cada dispositivo e quando, com filtros por dispositivo, intervalo de datas ou nome de conteúdo.

![History](screenshots/history.png)

### Modo escuro
Suporte total a tema claro e escuro, com deteção automática.

![Dark Mode](screenshots/dark-mode.png)

### Multi-idioma
Interface principal em português, com inglês como alternativa.

## Arquitetura

```
┌──────────────┐     HTTP API      ┌──────────────────┐
│  Dispositivo │◄──────────────────│  MupiTech        │
│  (Anthias)   │   /api/v2/*       │  Fleet Manager   │
│  Raspberry Pi│──────────────────►│  Django + React  │
│              │   phone-home      │  Docker Compose  │
└──────────────┘                   └──────────────────┘
```

O backend está organizado em apps Django modulares, uma por funcionalidade:

| App | Responsabilidade |
|-----|-------------------|
| `players` | Dispositivos, provisionamento, comunicação com a API do Anthias |
| `groups` | Grupos de dispositivos, ações em massa (incluindo rotação de ecrã) |
| `locations` | Localizações físicas e a sua hierarquia com grupos/dispositivos |
| `content` | Biblioteca de conteúdos (pastas e ficheiros) |
| `playlists` | Playlists de conteúdos aplicáveis a dispositivos, grupos ou localizações |
| `scheduling` | Faixas horárias, eventos e agendamento de reprodução |
| `deploy` | Tarefas de implementação de conteúdo nos dispositivos |
| `history` | Registo de auditoria e histórico de reprodução |
| `cctv` | Videovigilância RTSP (opcional, por feature flag) |

Cada funcionalidade opcional (como o CCTV) é controlada por uma flag em `FEATURES` (`fleet_manager/settings.py`), exposta ao frontend via `GET /api/system/features/` e consumida através de `useFeatures()`.

## Stack técnica

| Camada | Tecnologia |
|--------|-----------|
| Backend | Django 4.2 + Django REST Framework |
| Frontend | React 19 + TypeScript |
| UI | Bootstrap 5.3 + SASS |
| Fila de tarefas | Celery + Redis |
| Base de dados | PostgreSQL 16 |
| Implementação | Docker Compose |

## Instalação rápida

### Pré-requisitos

- Docker e Docker Compose
- Git

### Passos

```bash
git clone https://github.com/pedrom20/mupiteck.git
cd mupiteck
cp .env.example .env
docker compose up -d --build
```

A aplicação fica disponível em `http://localhost:9000`.

### Primeira conta

Não há credenciais por omissão — ao abrir a aplicação pela primeira vez
(base de dados sem nenhum superadmin), aparece um assistente de
configuração inicial para criar a primeira conta de administrador e,
opcionalmente, definir um logótipo de parceiro.

### Variáveis de ambiente

| Variável | Omissão | Descrição |
|----------|---------|-------------|
| `DJANGO_SECRET_KEY` | — (obrigatória se `DJANGO_DEBUG=False`) | Chave secreta do Django |
| `DJANGO_DEBUG` | `False` | Modo de depuração |
| `LANGUAGE_CODE` | `pt` | Idioma por omissão do backend |
| `TIME_ZONE` | `Europe/Lisbon` | Fuso horário |
| `WEB_PORT` | `9000` | Porta do anfitrião para a interface web |
| `DB_PASSWORD` | `fleet_manager_secret` | Palavra-passe do PostgreSQL |
| `PLAYER_POLL_INTERVAL` | `60` | Intervalo de sondagem dos dispositivos (segundos) |
| `ALLOWED_HOSTS` | `localhost,127.0.0.1` | Hosts permitidos, separados por vírgula |
| `CSRF_TRUSTED_ORIGINS` | — | Origens de confiança para CSRF |
| `PLAYER_REGISTER_TOKEN` | vazio (registo aberto) | Segredo partilhado para registo automático de dispositivos |
| `ANTHIAS_IMAGE_REGISTRY` / `ANTHIAS_IMAGE_TAG_SUFFIX_PI4` / `_PI5` | ver `docs/anthias-version-analysis.md` | Origem das imagens Anthias usadas no provisionamento |
| `UPDATE_CHECK_GITHUB_REPO` | `pedrom20/mupiteck` | Repositório usado pela verificação de atualizações da própria dashboard |
| `FEATURE_CCTV_ENABLED` | `False` | Ativa a funcionalidade opcional de videovigilância |

Ver [.env.example](.env.example) para a lista completa.

## Ligar dispositivos

### Registo automático (recomendado)

Executar no dispositivo Anthias:

```bash
curl -s "http://SERVIDOR_MUPITECH:9000/api/players/install-phonehome/?server=http://SERVIDOR_MUPITECH:9000" | bash
```

O dispositivo aparece no Fleet Manager em cerca de 30 segundos.

### Registo manual

1. Ir a **Dispositivos** > **Adicionar Dispositivo**
2. Introduzir o URL do dispositivo (ex.: `http://192.168.1.10`)
3. Introduzir credenciais, se o dispositivo tiver autenticação ativa

### Instalação remota por SSH ("Instalar Novo")

Em **Dispositivos** > **Adicionar Dispositivo** > **Instalar Novo**, o
Fleet Manager instala tudo por SSH numa máquina só com um SO base e
acesso SSH já preparados — Raspberry Pi 4, Raspberry Pi 5 ou um PC x86
normal (a arquitetura é sempre detetada automaticamente por SSH,
`uname -m`, independentemente da escolha feita no wizard, que serve só
para mostrar as instruções de preparação certas). Docker, as imagens e
o registo automático ficam todos tratados; no final o device já
aparece pronto no Fleet Manager.

### Provisionamento em massa

Em **Dispositivos** > **Provisionar em Massa**, para várias máquinas
já com SO+SSH preparados na mesma rede: procura por IPs (tabela ARP ou
intervalo de portas), credenciais SSH iguais para todas, e cada uma é
provisionada com a mesma deteção automática de arquitetura do fluxo
individual acima.

## Desenvolvimento

### Frontend

```bash
npm install
npm run dev     # Modo de observação com source maps
npm run build   # Compilação de produção
npm run lint    # ESLint
```

### Backend

```bash
pip install -r requirements.txt
python manage.py migrate
python manage.py runserver 0.0.0.0:9000
```

### Docker (reconstruir após alterações)

```bash
docker compose build web
docker compose up -d
```

**Nota para deploys via Portainer (stack criada por upload/colar, não
por git):** o `docker-compose.yml` que o Portainer usa é um ficheiro
próprio no servidor (`.../compose/<N>/docker-compose.yml`), independente
do repositório — não se atualiza sozinho quando o `docker-compose.yml`
do repositório muda (ex.: uma nova variável de ambiente). Depois de um
`git pull`, compara os dois (`diff`) e copia o do repositório para o
servidor antes de correr `docker compose up -d`, senão as variáveis
novas ficam silenciosamente por passar ao container. Isto não se aplica
se o servidor correr `docker compose` diretamente a partir de um clone
git (o caso do "Instalação rápida" acima) — aí basta `git pull`.

## Histórico de versões

Ver o histórico completo na aplicação em **Definições > Changelog**, acessível a partir do rodapé.

## Origem e atribuição

Este projeto é um fork adaptado do "Anthias Fleet Manager". O software que corre nos dispositivos é o [Anthias](https://github.com/Screenly/Anthias), projeto open-source mantido pela Screenly — a este projeto agradecemos o trabalho original. Ver [docs/anthias-version-analysis.md](docs/anthias-version-analysis.md) para o detalhe de compatibilidade entre a versão usada nos dispositivos e a versão oficial do Anthias.

## Licença

[MIT](LICENSE)

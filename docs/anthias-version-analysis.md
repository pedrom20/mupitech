# Análise: versão do Anthias usada nos players (fork vs. oficial)

## Resumo

O software Anthias que corre nos players (Raspberry Pi) **não é o Anthias oficial nem o
seu código-fonte está neste repositório**. É construído noutro fork, não referenciado
aqui, e publicado como imagens Docker em `ghcr.io/alex1981-tech/anthias-*`. Este
repositório (MupiTech Fleet Manager) só consome essas imagens já publicadas durante o
provisioning — não tem acesso ao código-fonte desse fork.

Esse fork acrescenta, do lado do servidor Anthias, várias funcionalidades que **não
existem na API v2 oficial atual do Anthias**. Por isso, a decisão tomada foi:

> **Manter as imagens do fork por agora**, tornando a origem da imagem configurável, e
> documentar aqui exactamente que funcionalidades dependem dele — para que uma futura
> migração para o Anthias oficial (ou a reimplementação dessas funcionalidades) seja uma
> decisão informada, não uma perda de funcionalidade silenciosa.

## Endpoints stock (existem no Anthias oficial)

Usados por `players/services.py::AnthiasAPIClient` e já documentados na API oficial:

- `assets` (listar/criar/obter/atualizar/apagar/controlar/ordenar/conteúdo)
- `backup`
- `device_settings` (GET/PATCH)
- `file_asset`
- `info`
- `integrations`
- `reboot`
- `recover`
- `shutdown`

## Endpoints só existentes no fork (sem equivalente oficial atual)

| Endpoint | Funcionalidade no Fleet Manager | Onde é usado |
|---|---|---|
| `GET /api/v2/viewlog` | Histórico de reprodução (`PlaybackLog`) | `players/tasks.py` (`_track_playback`) |
| `GET /api/v2/screenshot` | Captura de ecrã do dispositivo | `players/services.py::get_screenshot`, `players/views.py::screenshot` |
| `GET/POST/PUT/DELETE /api/v2/schedule/slots[...]`, `/api/v2/schedule/status` | Agendamento por slots (default/hora/evento) | `players/services.py`, `players/views.py` (ações `schedule-*`), `player-schedule.tsx` |
| `POST /api/v2/update` | Disparar atualização via Watchtower | `players/services.py::trigger_update` |
| `GET /api/v2/cec/status`, `POST /api/v2/cec/standby`, `POST /api/v2/cec/wake` | Controlo de energia da TV via HDMI-CEC | `players/services.py`, `players/views.py` |
| `GET /api/v2/ir/status`, `POST /api/v2/ir/test` | Controlo remoto por infravermelhos | `players/services.py`, `players/views.py` |

Migrar já para as imagens oficiais do Anthias quebraria **todas** estas funcionalidades,
porque os endpoints correspondentes simplesmente não existem no servidor Anthias
oficial atual.

## Funcionalidades independentes da versão da imagem (funcionam com Anthias oficial)

- **Phone-home** (`players/provision.py`, `players/views.py::install_phonehome`): um
  script bash + temporizador systemd instalado no sistema operativo do Pi (fora dos
  contentores). Só chama o endpoint stock `GET /api/v2/info` — funciona sem alterações
  contra o Anthias oficial.
- **`provision/templates/media_player.py`**: substitui, via bind-mount, o
  `viewer/media_player.py` do Anthias, para deteção automática do dispositivo de áudio
  HDMI ALSA em Pi4/Pi5 e um leitor de fallback FFmpeg. É montado sobre o ficheiro stock,
  independentemente da tag da imagem usada — continuaria a funcionar com imagens
  oficiais.

## Origem das imagens e watchtower

As imagens são publicadas em `ghcr.io/alex1981-tech/anthias-{server,nginx,viewer,celery,
websocket,redis}:latest-{pi4,pi5}-64` e atualizadas automaticamente via Watchtower
(poll a cada 5 min). Não há um pin reprodutível a um commit/tag específico do Anthias
oficial — os dispositivos seguem sempre o que o CI desse fork publicar em `latest-*`.

## Configurabilidade introduzida

Para não deixar esta dependência "hardcoded" nem bloquear uma futura migração, o
registo e o sufixo da tag da imagem passaram a ser configuráveis via variáveis de
ambiente (ver `.env.example`), lidas em `fleet_manager/settings.py` e usadas em
`players/provision.py` (renderização dos templates de compose e pull manual de imagens):

- `ANTHIAS_IMAGE_REGISTRY` (omissão: `ghcr.io/alex1981-tech`)
- `ANTHIAS_IMAGE_TAG_SUFFIX_PI4` (omissão: `latest-pi4-64`)
- `ANTHIAS_IMAGE_TAG_SUFFIX_PI5` (omissão: `latest-pi5-64`)

Os templates `provision/templates/docker-compose-player.yml` e
`docker-compose-player-pi5.yml` usam `$ANTHIAS_REGISTRY`/`$ANTHIAS_TAG_SUFFIX`
(sintaxe `string.Template` do Python, a mesma já usada para `$PI_IP`/`$PI_USER`/etc.),
substituídos em `players/provision.py::_render_compose` a partir destas definições.

## Trabalho futuro (fora do âmbito deste rebranding)

Para migrar verdadeiramente para o Anthias oficial sem perder funcionalidade, seria
necessário, no fork (ou num fork próprio da Câmara):

1. Confirmar quais destas seis funcionalidades (viewlog, screenshot, schedule-slots,
   update-trigger, CEC, IR) já foram ou podem ser submetidas/portadas para o Anthias
   oficial (`github.com/Screenly/Anthias`) como patches upstream.
2. Para as que não tiverem equivalente oficial, decidir entre manter um fork fino e
   documentado apenas com esses patches, ou reimplementá-las fora do Anthias (ex.: um
   agente companheiro que fale com o dispositivo via SSH/API local em vez de exigir
   alterações ao servidor Anthias).
3. Só depois disso faria sentido apontar `ANTHIAS_IMAGE_REGISTRY`/`ANTHIAS_IMAGE_TAG_SUFFIX_*`
   para imagens oficiais por omissão.

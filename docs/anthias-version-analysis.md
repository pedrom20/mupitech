# Análise: versão do Anthias usada nos players (fork vs. oficial)

## Resumo

Historicamente, os players (Raspberry Pi / x86) corriam imagens de um fork de
terceiros não mantido (`ghcr.io/alex1981-tech/anthias-*`, projeto pessoal, sem
CI de qualidade, atualmente parado), do qual dependíamos para várias
funcionalidades sem equivalente na API v2 oficial do Anthias.

Isso deixou de ser verdade: construímos o nosso próprio fork
([`pedrom20/mupitech-player`](https://github.com/pedrom20/mupitech-player),
ramo `mupitech-custom`, assente no Anthias oficial atual — Qt6/cage/Wayland,
não a base Qt5/VLC antiga do fork de terceiros), com paridade de
funcionalidades construída de raiz sobre o código atual. Publica em
`ghcr.io/pedrom20/mupitech-player-*`. Ver `MAINTENANCE.md` nesse repo para
ramos, cadência de rebase e versionamento.

## Estado por funcionalidade

| Funcionalidade | Onde vive agora | Notas |
|---|---|---|
| CEC (controlo de energia da TV) | Já nativo no Anthias oficial atual (`POST /api/v2/display/<on\|off>`, `DisplayPowerViewV2`) | Só foi preciso adaptar `players/services.py` para o endpoint único, em vez de reimplementar no fork |
| IR (infravermelhos) | Novo, no nosso fork (`src/anthias_server/lib/mupitech_ir.py`, via `ir-ctl`/v4l-utils) | Precisa de validação com recetor IR real |
| Auto-update | Novo, no nosso fork — proxy fino para a API HTTP do Watchtower já corrido fleet-wide | Sem dependência de hardware |
| Screenshot | Novo, no nosso fork — `grim` sobre Wayland/cage (x86/Pi5/arm64); `ffmpeg -f kmsgrab` sobre eglfs/KMS (Pi4-64/Pi3-64) | kmsgrab lê o framebuffer de scanout em modo só-leitura, sem precisar de ser DRM master — coexiste com o processo do webview, que já o é. Pi2/Pi3 (fbdev) ainda não implementado — `/v2/screenshot` reporta "not supported" aí |
| Agendamento (schedule) | Adotado do próprio branch oficial `schedule-slots` do Anthias (campos `play_days`/`play_time_from`/`play_time_to` no `Asset`, não uma entidade separada de slots) | Fleet Manager reconciliado para este modelo mais simples (`players/services.py`, `player-detail.tsx`) |
| Viewlog / histórico de reprodução | **Não implementado em lado nenhum** | O campo `viewlog` do `/api/v2/info` oficial atual é um stub (`'Not yet implemented'`) — nem o Anthias oficial nem o nosso fork o preenchem a sério. `players/tasks.py::_track_playback` já falha em silêncio contra isto (não é um bug, é uma lacuna de funcionalidade conhecida, sem prazo definido) |

## Origem das imagens e registos configuráveis

`fleet_manager/settings.py` define registo/tag por tipo de dispositivo,
usados em `players/provision.py` (renderização dos templates de compose,
pull manual de imagens) e `players/views.py` (verificação de atualização):

- `ANTHIAS_IMAGE_REGISTRY_X86` / `ANTHIAS_IMAGE_TAG_SUFFIX_X86` (omissão:
  `ghcr.io/pedrom20/mupitech-player` / `latest-x86`)
- `ANTHIAS_IMAGE_REGISTRY_PI4` / `ANTHIAS_IMAGE_TAG_SUFFIX_PI4` (omissão:
  `ghcr.io/pedrom20/mupitech-player` / `latest-pi4-64`)
- `ANTHIAS_IMAGE_REGISTRY_PI5` / `ANTHIAS_IMAGE_TAG_SUFFIX_PI5` (omissão:
  `ghcr.io/pedrom20/mupitech-player` / `latest-pi5`)
- `ANTHIAS_IMAGE_REGISTRY` (omissão: `ghcr.io/alex1981-tech`) — mantida só
  como fallback defensivo para um `device_type` desconhecido; nenhum dos
  três tipos reais usa isto desde a Fase 5.

Os templates `docker-compose-player-{x86,pi4,pi5}.yml` usam
`$ANTHIAS_REGISTRY`/`$ANTHIAS_TAG_SUFFIX` (sintaxe `string.Template` do
Python, a mesma já usada para `$PI_IP`/`$PI_USER`/etc.), substituídos em
`players/provision.py::_render_compose`.

Todos os três seguem agora a mesma forma de 4 serviços do Anthias oficial
atual (server, viewer, celery — imagem partilhada com o server, redis) mais
Watchtower, em vez da forma de 6 serviços do fork antigo (server, nginx,
viewer, celery, websocket, redis).

## Pi4/Pi5: construído, ainda não validado em hardware real

As imagens `pi4-64`/`pi5` já constroem e publicam no CI do fork (Fase 5), e
o Fleet Manager já sabe provisionar/atualizar contra elas — mas ainda não
foram confirmadas contra Pi4/Pi5 físicos. Antes de apontar um dispositivo de
produção:

1. Confirmar arranque limpo do viewer (cage/Wayland no Pi5; eglfs/KMS no
   Pi4-64) e do CEC (`/dev/cec0`/`/dev/cec1`, já declarados no template do
   Pi5 — o do Pi4 deixa isso como opt-in comentado, por incerteza sobre a
   disponibilidade real de CEC nesse hardware).
2. A ação "Migrar para imagem MupiTech" (`players/migrate_image.py`) está
   deliberadamente limitada a x86 (`_MIGRATABLE_DEVICE_TYPES`) até essa
   validação — estender a lista quando Pi4/Pi5 estiverem confirmados.

# tribridge

**Claude Code ⇄ Codex ⇄ Antigravity.** Un solo núcleo que permite que cualquiera de los tres
agentes de código le delegue trabajo a los otros dos, o les pida una revisión independiente,
y que después verifique el resultado.

```
          ┌──────────── tribridge (Node, sin dependencias) ────────────┐
Claude Code ──►  delegate / review / job  ──►  codex exec · agy -p · claude -p
Codex       ──►        (mismo CLI)        ──►  (el que no seas tú)
Antigravity ──►                           ──►
          └──── digest + pie "[tribridge] files changed (git): …" ─────┘
```

Inspirado en [antigravity-for-claude-code](https://github.com/yuting0624/antigravity-for-claude-code)
(MIT), que solo va en una dirección (Claude → Gemini) y depende de bash.
Esto es una reimplementación que sirve en las tres direcciones.

## Qué mejora respecto al original

| | original | tribridge |
|---|---|---|
| Direcciones | Claude → agy | cualquiera → cualquiera (Claude, Codex, agy) |
| Revisión cruzada | 1 modelo | los otros 2 **en paralelo**, sin ver la opinión del otro |
| Windows nativo | no recomendado (bash + `timeout`, agy se colgaba) | **sí**: Node puro, sin shell, sin WSL |
| ¿La escritura pasó de verdad? | hay que revisar a mano | pie automático con los archivos que **git** ve cambiados, y aviso si un write no cambió nada o un read sí |
| Tokens del agente padre | se heredaban (medido: `CLAUDE_CODE_MESSAGING_TOKEN` llegaba a Gemini) | se eliminan antes de lanzar al agente hijo |
| Delegación en cadena | sin límite | un delegado no puede volver a delegar (exit 14) |
| Prompts largos | argv (límite ~32K en Windows) | stdin para claude/codex; archivo temporal para agy |
| Subagente de Claude | filtro de Bash en bash | filtro en Node que falla cerrado y bloquea `$VAR`, `$(…)`, pipes y redirecciones |

## Requisitos

- Node ≥ 18
- Al menos **dos** de: [Claude Code](https://claude.com/claude-code), [Codex CLI](https://github.com/openai/codex),
  [Antigravity CLI](https://antigravity.google/docs/cli-using) (`agy`), instalados y con **tu** sesión iniciada.

## Instalación

Es un plugin nativo de las tres herramientas: instálalo en la que uses (o en las tres),
con el instalador de esa misma herramienta.

**Claude Code**: en el prompt de Claude Code:
```
/plugin marketplace add JoakoVRD-Designer/tribridge
/plugin install tribridge@tribridge
```

**Codex**: en una terminal:
```bash
codex plugin marketplace add JoakoVRD-Designer/tribridge
codex plugin add tribridge@tribridge
```

**Antigravity (agy)**: agy solo instala plugins desde una carpeta, así que primero clonas el repo:
```bash
git clone https://github.com/JoakoVRD-Designer/tribridge.git
agy plugin install ./tribridge
```

Reinicia la herramienta después de instalar. Listo: dile en lenguaje natural "pídele a Codex una
segunda opinión", "que Gemini lo busque en la web", "usa GPT-6 Astra en Codex"…

**Opcional**: el comando `tribridge` en tu terminal (para usarlo a mano, o para instalar en
Codex y agy de una vez):
```bash
git clone https://github.com/JoakoVRD-Designer/tribridge.git && cd tribridge
npm install -g .
tribridge install codex agy    # ejecuta por ti los instaladores nativos de arriba
tribridge doctor               # qué agentes están listos, con sesión y con el plugin
```

Cada plugin trae su propia copia del código, así que el skill funciona aunque `tribridge` no esté
en el PATH. En Claude Code además trae los comandos `/tribridge:delegate`, `/tribridge:review`,
`/tribridge:model`, `/tribridge:jobs` y `/tribridge:doctor`, el subagente `tribridge-delegate` y un
recordatorio al iniciar sesión (se desactiva con `TRIBRIDGE_POLICY=off`). En agy los comandos
aparecen como skills.

**Qué necesita cada persona:** la CLI de cada IA a la que quiera delegar, instalada y con **su propia**
sesión iniciada (Node ≥ 18 también). tribridge no incluye acceso a ninguna IA, solo las conecta.
Con dos de las tres ya funciona.

**Actualizar:** Claude Code `/plugin marketplace update tribridge` · Codex `codex plugin marketplace upgrade tribridge` ·
agy `git pull` y de nuevo `agy plugin install ./tribridge`.

**Desinstalar:** `/plugin uninstall tribridge@tribridge` · `codex plugin remove tribridge@tribridge` ·
`agy plugin uninstall tribridge` (o `tribridge uninstall all`).

## Uso

```bash
# delegar una tarea (por defecto solo lectura)
tribridge delegate --to agy --tier fast "Lista todas las llamadas a parseConfig; solo file:line."

# que edite archivos
tribridge delegate --to codex --mode write --dir . "Agrega tests para src/cart.ts: carrito vacío y descuento."

# revisión independiente del diff actual por los OTROS dos agentes, en paralelo
tribridge review
tribridge review --base main --adversarial

# tareas largas en segundo plano
tribridge job start --to agy --tier deep "…"
tribridge job status
tribridge job result <id>
```

Dentro de Claude Code, Codex o Antigravity no hace falta escribir comandos: pídelo en lenguaje
natural ("pídele a Codex una segunda opinión sobre este diff", "que Gemini busque en la web…")
y el skill `tribridge` hace el resto.

### Tiers

| tier | claude | codex | agy |
|---|---|---|---|
| `fast` | haiku | effort low | Gemini 3.8 Flash (Low) |
| `balanced` (defecto) | sonnet | effort medium | Gemini 3.8 Flash (High) |
| `deep` (defecto en `review`) | opus, effort high | effort high | Gemini 3.1 Pro (High) |

### Cambiar de modelo en cada IA

```bash
tribridge models                              # modelos disponibles de las 3 (lista real de cada CLI; * = en uso)
tribridge model set codex gpt-6-astra         # Codex usa GPT-6 Astra en todos los tiers (queda guardado)
tribridge model set agy gemini-3.1-pro-high --tier deep
tribridge model set claude opus --effort high
tribridge model                               # qué modelo y esfuerzo usa cada una
tribridge model reset                         # volver a los valores por defecto
```

Desde Claude Code: `/tribridge:model codex gpt-6-astra`, o simplemente "usa GPT-6 Astra en Codex".
Valida contra la lista real de modelos (y los niveles de esfuerzo que admite cada modelo); `--force` lo salta.

Para una sola llamada: `--model` / `--effort`. En `review`, por agente:
`tribridge review --model codex=gpt-6-astra,agy=gemini-3.1-pro-high`.

Se guarda en `~/.tribridge/config.json`.

### Modos: qué impone cada agente (medido, sin maquillar)

| modo | claude | codex | agy |
|---|---|---|---|
| `read` | **impuesto**: `dontAsk` + solo Read/Glob/Grep/Web | **impuesto**: sandbox `read-only` | **instrucción** + aviso de git (ver abajo) |
| `write` | impuesto: además Edit/Write; nada de shell | sandbox `workspace-write` | escribe si la carpeta está en `trustedWorkspaces` o tiene una regla `write_file(<dir>)`; si no, exit 15 |
| `yolo` | `bypassPermissions` | sin sandbox | `--dangerously-skip-permissions` |

`yolo` aprueba **todo en toda la máquina**, no solo en `--dir`. Úsalo solo en una rama desechable.

**agy no tiene un modo de solo lectura que se pueda imponer en modo no interactivo.**
Medido con agy 1.2.9: con la carpeta personal en `trustedWorkspaces`, agy escribe sin pedir permiso,
y `--mode plan` hace que devuelva una respuesta vacía para cualquier tarea. Por eso `tribridge`
le antepone una instrucción de solo lectura (en las pruebas la respetó 2 de 2 veces), y el pie de
git avisa si igual cambió algo. Si quieres que agy de verdad no pueda escribir, saca tu carpeta
personal de `trustedWorkspaces` en `~/.gemini/antigravity-cli/settings.json`.

### Códigos de salida

`0` ok · `1` uso · `2` falló el agente · `3` respuesta vacía · `10` cuota o límite de uso · `11` sin sesión ·
`12` timeout · `13` no se encuentra la CLI · `14` delegación anidada rechazada · `15` permiso denegado ·
`16` el sandbox del propio agente que llama bloqueó el lanzamiento (en Codex: aprueba ejecutarlo fuera del sandbox)

Cada llamada deja en stderr una línea `TRIBRIDGE_USAGE {…}` con el agente, el modelo, el tiempo y los tokens.
Con `TRIBRIDGE_USAGE_LOG=<archivo>` (o `usageLog` en la config) además se guarda en ese archivo.

## Detalles de Windows (medidos en Windows 11)

- `agy -p` lanzado desde Node, con stdin cerrado y sin shell, **no se cuelga**. El cuelgue del
  original venía de lanzarlo desde Git Bash.
- El sandbox "elevated" de Codex **no puede crear procesos** cuando a Codex lo lanza otro programa:
  todos los comandos fallan con `helper_unknown_error`. `tribridge` le pasa
  `-c windows.sandbox="unelevated"`, que funciona y respeta igual `--sandbox`.
  Se cambia con `codexWindowsSandbox` en la config.
- Los shims `.cmd` de npm no se ejecutan a través de `cmd.exe`: `tribridge` lee el shim y lanza
  directamente el `.exe` o el `.js`, así el prompt nunca pasa por el escapado de cmd.

## Pruebas

```bash
npm test     # 23 pruebas con agentes falsos: sin red y sin gastar tokens
```

Probado también contra los agentes reales (claude 2.1.281, codex 0.156.1, agy 1.2.9):

- revisión cruzada de un diff con dos bugs puestos a propósito: Codex y Gemini encontraron los dos, cada uno por su cuenta, en 31 s;
- escritura real con Codex y con agy, con el pie de git correcto;
- delegación de lectura a Claude.

## Licencia

MIT. Ver [LICENSE](LICENSE).

# robocze

Mody do Claude Code (terminal albo zakładka Code w Claude Desktop):

| Mod | Co robi |
| --- | --- |
| [`mods/handoff`](mods/handoff) | Przy 70% kontekstu przypomina o `/handoff`, który zapisuje stan pracy do `.claude/handoffs/` |
| [`mods/model-hint`](mods/model-hint) | Proste prompty idą na jedną turę z Opusa na Sonnet albo Haiku, żeby oszczędzać limit |

Oba naraz:

```
claude --plugin-dir C:\ścieżka\do\robocze\mods\handoff --plugin-dir C:\ścieżka\do\robocze\mods\model-hint
```

Na stałe: wpisz te ścieżki do `CLAUDE_CODE_PLUGIN_DIRS` (rozdzielone `;`) w bloku `env` pliku `~/.claude/settings.json`.

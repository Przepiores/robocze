# robocze

Mody do Claude Code (terminal albo zakładka Code w Claude Desktop):

| Mod | Co robi |
| --- | --- |
| [`mods/handoff`](mods/handoff) | Przy 70% kontekstu przypomina o `/handoff`, który zapisuje stan pracy do `.claude/handoffs/` |
| [`mods/model-hint`](mods/model-hint) | Proste prompty idą na jedną turę z Opusa na Sonnet albo Haiku, żeby oszczędzać limit |
| [`mods/kokpit`](mods/kokpit) | Panel boczny: co robi Claude, 3 propozycje „co dalej”, ostatnia praca w projekcie, kontekst i limity, ocena czy rozmowa pasuje do Code, Coworka czy chatu |

Wszystkie naraz:

```
claude --plugin-dir C:\ścieżka\do\robocze\mods\handoff --plugin-dir C:\ścieżka\do\robocze\mods\model-hint --plugin-dir C:\ścieżka\do\robocze\mods\kokpit
```

Na stałe: wpisz te ścieżki do `CLAUDE_CODE_PLUGIN_DIRS` (rozdzielone `;`) w bloku `env` pliku `~/.claude/settings.json`.

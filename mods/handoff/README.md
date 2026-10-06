# handoff: zapis stanu pracy przed kompaktowaniem

Mod do Claude Code, który pilnuje zapełnienia kontekstu i pozwala jedną komendą zapisać notatkę „gdzie skończyliśmy”, zanim kompaktowanie albo `/clear` zgubi szczegóły.

- Przy **70%** kontekstu (próg da się zmienić) pokazuje toast i wpis w status line: `Kontekst 72%: /handoff`. Toast pojawia się raz; uzbraja się znowu, gdy kontekst spadnie 10 punktów poniżej progu (np. po `/compact`).
- **`/handoff`** prosi model (przez fork bieżącej rozmowy, bez narzędzi) o notatkę po polsku z sekcjami: Cel, Zrobione, W toku, Następne kroki, Zmienione pliki, Decyzje i ustalenia, Otwarte problemy i pułapki. Zapisuje ją do `.claude/handoffs/RRRR-MM-DD-GGMM.md` i kopię do `.claude/handoffs/LATEST.md` w katalogu projektu.
- **`/handoff compact`** robi to samo, a chwilę później kompaktuje rozmowę z instrukcją, że pełny stan jest w zapisanym pliku.
- **`/handoff load`** wczytuje `LATEST.md` do rozmowy jako kontekst dla modelu. Po starcie sesji, jeśli w projekcie jest handoff młodszy niż 24 h, mod przypomina o tym toastem.
- **Siatka bezpieczeństwa:** gdy Claude Code sam kompaktuje rozmowę, a w ostatnich 10 minutach nie było `/handoff`, mod zapisuje podsumowanie z kompaktowania jako `.claude/handoffs/auto-….md`.
- W repo gita mod przy pierwszym zapisie dopisuje `.claude/handoffs/` do `.gitignore`, chyba że folder (albo całe `.claude/`) jest już ignorowany.

## Instalacja

Działa w Claude Code (terminal albo zakładka Code w Claude Desktop). Nie działa w Coworku ani w zwykłym czacie.

```
claude --plugin-dir C:\ścieżka\do\Notch-for-win-11\mods\handoff
```

Kilka modów naraz: powtórz `--plugin-dir` dla każdego folderu albo wpisz ścieżki do `CLAUDE_CODE_PLUGIN_DIRS` (rozdzielone `;` na Windows) w bloku `env` pliku `~/.claude/settings.json`.

Próg ustawisz w `/config` (wiersz „Próg ostrzeżenia (%)”) albo w `settings.json`:

```json
{ "pluginConfigs": { "handoff": { "threshold": 65 } } }
```

Sprawdzenie i testy:
```
claude plugin validate mods/handoff
claude plugin test mods/handoff
```

## Koszt

`/handoff` to jedno zapytanie do modelu sesji na bazie całej rozmowy. Jeśli od ostatniej odpowiedzi minęło niewiele czasu, większość rozmowy przychodzi z cache i jest tania; po dłuższej przerwie cache wygasa i całość liczy się od nowa. Siatka przy auto-kompaktowaniu nic nie kosztuje: zapisuje podsumowanie, które Claude Code i tak wygenerował.

## Pliki

| Plik | Co robi |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest i ustawienie `threshold` |
| `hooks/register.ts` | Hooki: `session.start` (komenda, przypomnienie), `session.measure` (próg), `command.run` (`/handoff`), `session.compact` (siatka) |
| `hooks/logic.ts` | Próg i ponowne uzbrajanie, nazwy plików, prompt handoffu, `.gitignore` |
| `hooks/register.test.ts` | Testy logiki, progu, komendy i siatki (13) |
| `types/index.d.ts` | Kontrakt stanu `handoff.warned`, `handoff.savedAt` |

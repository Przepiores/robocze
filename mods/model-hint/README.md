# model-hint: proste prompty na tańszy model

Mod do Claude Code, który oszczędza limit Opusa: zanim tura wyśle pierwsze zapytanie, mały model klasyfikuje Twój prompt, a proste prompty idą **na tę jedną turę** na Sonnet albo Haiku. Model sesji się nie zmienia, kolejna tura znowu zaczyna od Opusa.

| Klasa promptu | Przykład | Model tury |
| --- | --- | --- |
| trywialny | szybkie pytanie, przeformułowanie, rename, zmiana jednej linii | Haiku |
| standardowy | zwykłe zadanie w kodzie, wyjaśnienie, edycja jednego pliku, prosty bug | Sonnet |
| złożony | architektura, refaktor wielu plików, trudny debug, planowanie, research | Opus |

Przy przełączeniu pojawia się toast („Prosty prompt: ta tura idzie na Sonnet”) i wpis w status line na czas tury.

## Kiedy mod nic nie robi

- Model sesji to nie Opus.
- Prompt jest krótki (poniżej 25 znaków) albo wygląda na kontynuację („tak”, „dalej”, „zrób to”…). Taki prompt opiera się na bieżącym zadaniu, więc zostaje na Opusie.
- Prompt to slash-komenda albo nie został wpisany przez Ciebie (zaplanowane zadanie, powiadomienie, inna sesja, `claude -p`).
- **Kontekst przekracza 30%.** Tańszy model nie ma Twojej rozmowy w cache i czytałby ją całą od zera, więc przy dużym kontekście przełączenie kosztowałoby więcej, niż oszczędza. Klasyfikacja jest wtedy w ogóle pomijana.
- Klasyfikator zawiódł albo odpowiedział nie na temat: tura zostaje na Opusie.

## Sterowanie

- `!opus`, `!sonnet` albo `!haiku` na początku promptu wymusza model na tę turę (prefiks jest usuwany z promptu).
- `/model-hint off` / `/model-hint on` wyłącza i włącza przełączanie (pamiętane między sesjami).
- `/model-hint stats` pokazuje, ile promptów poszło na tańszy model.
- W `/config` albo w `settings.json`:

```json
{ "pluginConfigs": { "model-hint": { "enabled": true, "maxContext": 30 } } }
```

## Instalacja

Działa w Claude Code (terminal albo zakładka Code w Claude Desktop). Nie działa w Coworku ani w zwykłym czacie.

```
claude --plugin-dir C:\ścieżka\do\Notch-for-win-11\mods\model-hint
```

Sprawdzenie i testy:
```
claude plugin validate mods/model-hint
claude plugin test mods/model-hint
```

## Koszt i ograniczenia

- Każdy kwalifikujący się prompt to jedno małe zapytanie do szybkiego modelu (klasyfikacja), uruchamiane równolegle ze startem tury.
- Przełączona tura zostaje na tańszym modelu do końca, także w pętli narzędzi. Jeśli zadanie okaże się trudniejsze, napisz kolejny prompt z `!opus`.
- Po turze na Sonnecie powrót na Opusa korzysta z cache Opusa, o ile nie minęło zbyt dużo czasu.

## Pliki

| Plik | Co robi |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest i ustawienia `enabled`, `maxContext` |
| `hooks/register.ts` | Hooki: `prompt.submit` (filtr, `!model`), `turn.start` (klasyfikacja), `turn.step` (zmiana modelu tury), `turn.complete`, komenda `/model-hint` |
| `hooks/logic.ts` | Etykiety klasyfikatora, filtry promptów, statystyki |
| `hooks/register.test.ts` | Testy logiki i routingu (12) |

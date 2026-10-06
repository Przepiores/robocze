# kokpit: panel boczny z podglądem pracy Claude'a

Mod do Claude Code, który otwiera z boku panel **Kokpit** z trzema sekcjami.

```
TERAZ
● pracuje · tura 4 · krok 3
✓ Read hooks/logic.ts  0.2 s
● Edit hooks/register.ts
↳ szukam hooków
Pliki w sesji:
 hooks/register.ts ×3

SESJA
Kontekst 34% (68k / 200k)
Koszt sesji $1.20
Limit 5h: 62% · reset 23:40

MIEJSCE
Ocena: Cowork
dokumenty, research, pliki, poczta: Cowork zrobi z tego plik lub dokument
Lepiej prowadzić w: Cowork
[ Przenieś do Cowork ]  [ Zostaję w Code ]
```

## Sekcje

**Teraz.** Na żywo pokazuje numer tury i krok (zapytanie do modelu), ostatnie 8 wywołań narzędzi z czasem i wynikiem (✓, ✗, ● w trakcie), uruchomionych subagentów oraz pliki edytowane w tej sesji. Nie generuje żadnych dodatkowych zapytań do modelu.

**Sesja.** Pokazuje zapełnienie kontekstu, koszt sesji i Twoje limity planu (okno 5-godzinne i tygodniowe) z godziną resetu. Dane pochodzą z tego, co API zwraca przy każdej odpowiedzi.

**Miejsce.** Doradza, gdzie najlepiej prowadzić rozmowę:

| Ocena | Kiedy |
| --- | --- |
| **Code** | praca w repo: kod, testy, build, git, debug, mody |
| **Cowork** | dokumenty Word, Excel, PowerPoint, raporty z researchu, porządki w plikach, mail, kalendarz, Drive, zadania cykliczne |
| **Chat** | pytania i wyjaśnienia, nauka, burza mózgów, krótkie teksty, bez plików i narzędzi |

- Ocenia mały, szybki model co 3 tury: czyta ostatnie prompty i to, ile tury używały narzędzi.
- Od razu sprawdza prompt, który prosi o dokument, arkusz, prezentację, raport, maila, kalendarz albo Drive. Tak samo po trzech turach z rzędu bez żadnego narzędzia.
- Sugestia „Lepiej prowadzić w …” pojawia się dopiero po **dwóch ocenach z rzędu** wskazujących to samo miejsce inne niż Code. Pierwszy głos jest potwierdzany już w następnej turze. Toast wyskakuje raz na sugestię.
- **Przenieś do …** prosi model o wiadomość startową (cel, ustalenia, kontekst, czego chcesz teraz) i kopiuje ją do schowka. Gdy schowek nie działa (np. w aplikacji desktopowej), zapisuje ją do `.claude/handoffs/przeniesienie-….md`. Przy sugestii czatu jest też link do claude.ai.
- **Zostaję w Code** chowa sugestię, dopóki ocena się nie zmieni.
- **Sprawdź teraz** albo komenda `/gdzie` od razu wydaje ocenę.

## Ograniczenia

- Mody działają tylko w Claude Code (terminal i zakładka Code w aplikacji desktopowej). Doradca miejsca podpowiada więc tylko w jedną stronę: z Code do Coworka albo chatu. W Coworku i czacie nie podpowie „przejdź do Code”.
- Panel otwarty automatycznie mieści się w terminalu od 144 kolumn. W węższym oknie użyj `/kokpit`.
- Po przeładowaniu moda doradca zaczyna liczenie tur od nowa. Sekcje Teraz i Sesja zachowują stan.

## Instalacja

```
claude --plugin-dir C:\ścieżka\do\robocze\mods\kokpit
```

Ustawienia w `/config` albo w `settings.json`:

```json
{ "pluginConfigs": { "kokpit": { "placeEnabled": true, "placeEvery": 3 } } }
```

Sprawdzenie i testy:
```
claude plugin validate mods/kokpit
claude plugin test mods/kokpit
```

## Koszt

- Teraz i Sesja: zero dodatkowych zapytań.
- Ocena miejsca: jedno małe zapytanie do szybkiego modelu co kilka tur.
- Przeniesienie: jedno zapytanie do modelu sesji na bazie rozmowy (jak `/handoff`), tylko po kliknięciu.

## Pliki

| Plik | Co robi |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest i ustawienia `placeEnabled`, `placeEvery` |
| `hooks/register.tsx` | Hooki tury, narzędzi i pomiaru sesji, panel (`ui.render` na `Pane`), komendy `/kokpit` i `/gdzie`, ocena i przeniesienie |
| `hooks/logic.ts` | Etykiety narzędzi, limity, sygnały i etykiety klasyfikatora, reguła dwóch głosów, prompt przeniesienia |
| `hooks/register.test.ts` | Testy logiki, panelu na terminalu i desktopie, doradcy i przenoszenia (15) |
| `types/index.d.ts` | Kontrakt stanu `kokpit.activity`, `kokpit.session`, `kokpit.place` |

# kokpit: panel boczny z podglądem pracy Claude'a

Mod do Claude Code, który otwiera z boku panel **Kokpit** z pięcioma sekcjami.

```
TERAZ
● pracuje · tura 4 · krok 3
✓ Read hooks/logic.ts  0.2 s
● Edit hooks/register.ts
↳ szukam hooków
Pliki w sesji:
 hooks/register.ts ×3

CO DALEJ?
[ Uruchom testy kokpitu ]
[ Zrób commit zmian ]
[ Dopisz sekcję do README ]
Inne propozycje

OSTATNIO W PROJEKCIE
Handoff z wczoraj 22:13
 Cel: Mody handoff i model-hint do Claude Code
 Dalej: Sprawdzić alias modelu w turn.step
 Otwarte: strefa czasowa w nazwach plików
[ Wczytaj handoff ]
Poprzednie sesje:
 wczoraj 21:40 · mody do claude code
Wróć do sesji (/resume)
Ostatnie commity:
 73dfc91 feat(mods): add kokpit side pane

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

**Co dalej?** Po każdej odpowiedzi szybki model (Haiku) czyta Twój ostatni prompt, końcówkę odpowiedzi, pliki zmienione w sesji i „Następne kroki” z ostatniego handoffu. Na tej podstawie proponuje 3 konkretne prompty. Kliknięcie wpisuje prompt do pola, a Ty go poprawiasz albo wysyłasz Enterem. **Inne propozycje** losuje nowe.

**Ostatnio w projekcie.**
- Skrót ostatniego handoffu (z moda handoff, plik `.claude/handoffs/LATEST.md`): kiedy, cel, pierwszy następny krok i otwarty problem. **Wczytaj handoff** uruchamia `/handoff load`; bez moda handoff wpisuje do pola prompt, który każe przeczytać ten plik.
- 3 poprzednie sesje w tym projekcie z datą i tytułem (z transkryptów Claude Code). **Wróć do sesji** wpisuje `/resume`.
- 3 ostatnie commity z `git log`.

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
- Po przeładowaniu moda doradca zaczyna liczenie tur od nowa. Pozostałe sekcje zachowują stan.
- Tytuł poprzedniej sesji pochodzi z jej transkryptu. Transkrypty większe niż 4 MiB są pokazywane jako „(bez podglądu)”.

## Instalacja

```
claude --plugin-dir C:\ścieżka\do\robocze\mods\kokpit
```

Ustawienia w `/config` albo w `settings.json`:

```json
{ "pluginConfigs": { "kokpit": { "nextEnabled": true, "placeEnabled": true, "placeEvery": 3 } } }
```

Sprawdzenie i testy:
```
claude plugin validate mods/kokpit
claude plugin test mods/kokpit
```

## Koszt

- Teraz i Sesja: zero dodatkowych zapytań.
- Ocena miejsca: jedno małe zapytanie do szybkiego modelu co kilka tur.
- Co dalej?: jedno małe zapytanie do Haiku po każdej odpowiedzi (wyłączysz to w ustawieniach).
- Ostatnio w projekcie: zero zapytań do modelu, tylko odczyt plików i `git log`.
- Przeniesienie: jedno zapytanie do modelu sesji na bazie rozmowy (jak `/handoff`), tylko po kliknięciu.

## Pliki

| Plik | Co robi |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest i ustawienia `nextEnabled`, `placeEnabled`, `placeEvery` |
| `hooks/register.tsx` | Hooki tury, narzędzi i pomiaru sesji, panel (`ui.render` na `Pane`), komendy `/kokpit` i `/gdzie`, propozycje, „ostatnio”, ocena i przeniesienie |
| `hooks/logic.ts` | Etykiety narzędzi, limity, sygnały i etykiety klasyfikatora, reguła dwóch głosów, prompt przeniesienia |
| `hooks/next.ts` | Prompt i parsowanie propozycji „Co dalej?” |
| `hooks/recent.ts` | Odczyt handoffu, tytułów sesji z transkryptów, daty względne |
| `hooks/register.test.ts` | Testy logiki, panelu na terminalu i desktopie, propozycji, „ostatnio”, doradcy i przenoszenia (25) |
| `types/index.d.ts` | Kontrakt stanu `kokpit.activity`, `.session`, `.place`, `.next`, `.recent` |

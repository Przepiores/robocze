# Test integracji: szlif + Kokpit (na żywo, w Claude Code)

Testy jednostkowe (`claude plugin test`) sprawdzają logikę w symulowanym silniku. Ten test sprawdza to, czego symulacja nie pokaże: prawdziwe okno pytań przed startem tury, wstawianie promptu do pola, pasek statusu, panel Kokpitu na terminalu i współpracę z model-hint.

Przebieg:

1. **Przygotowanie** (zwykła sesja Claude Code, dowolny folder): Claude aktualizuje repo, odpala validate i testy, zakłada piaskownicę `%USERPROFILE%\szlif-test` i podaje komendę startu.
2. **Sesja testowa** (w piaskownicy, z modami): Claude jest **prowadzącym testu**. Twoje prompty testowe to dane wejściowe: Claude ich nie wykonuje, tylko odsyła dokładnie to, co do niego dotarło (czyli to, co wysłał szlif). Ty klikasz w Kokpicie, odpowiadasz na pytania i opisujesz, co widzisz.
3. **Raport**: prowadzący zbiera wyniki, log debug i wynik testów w `%USERPROFILE%\szlif-test\TEST-REPORT.md`. **Kodu modów nie poprawia.**

---

## Część A: przygotowanie (dla Claude Code)

1. Znajdź klon repo `Przepiores/robocze` na tym komputerze (sprawdź `git remote -v`). Dalej `<REPO>` to jego ścieżka. Zrób `git -C <REPO> pull`.
2. Odpal i zapisz wynik:
   - `claude --version`
   - `claude plugin validate <REPO>\mods\szlif` i to samo dla `kokpit` i `model-hint`
   - `claude plugin test <REPO>\mods\szlif` i `claude plugin test <REPO>\mods\kokpit`
3. Sprawdź, czy `CLAUDE_CODE_PLUGIN_DIRS` (zmienna środowiskowa albo blok `env` w `~/.claude/settings.json`) już ładuje któryś z modów. Jeśli tak, zapisz to: w sesji testowej mod nie może się załadować dwa razy.
4. Załóż piaskownicę `%USERPROFILE%\szlif-test` (jeśli istnieje, wyczyść ją), `git init` i pliki:
   - `README.md`: „Mała aplikacja testowa: logowanie i eksport danych.”
   - `package.json` z `"scripts": { "test": "node test.js" }`
   - `src\login.ts`: funkcja `login(email, password)` bez walidacji, z jednym komentarzem po angielsku
   - `src\export.ts`: pusta funkcja `exportData()`
   - `test.js`: `console.log('ok')`
   - Commit: `chore: sandbox for szlif test`
5. Skopiuj ten plik do piaskownicy jako `TESTING.md`.
6. Podaj mi gotową komendę PowerShell do startu sesji testowej, z prawdziwymi ścieżkami:
   ```
   cd $env:USERPROFILE\szlif-test
   claude --debug --plugin-dir <REPO>\mods\szlif --plugin-dir <REPO>\mods\kokpit --plugin-dir <REPO>\mods\model-hint
   ```
   Pomiń `--plugin-dir` modów, które już ładuje `CLAUDE_CODE_PLUGIN_DIRS`. Napisz, żeby okno terminala miało co najmniej 144 kolumny (inaczej Kokpit trzeba otworzyć `/kokpit`).
7. Zapisz wyniki punktów 1–3 na początku `%USERPROFILE%\szlif-test\TEST-REPORT.md` w sekcji „Przygotowanie”.

---

## Część B: sesja testowa (dla prowadzącego)

### Zasady prowadzącego

- Jesteś prowadzącym test modów **szlif** i **kokpit**. Nie wykonujesz żadnego zadania z promptów testowych, nie edytujesz plików w `src\` i nie zmieniasz kodu modów.
- **Wiadomość zaczynająca się od `obs:`** to obserwacja użytkownika: zapisz ją przy bieżącym kroku. Użytkownik wpisuje je jako `-- obs: …`, bo prefiks `-- ` chroni je przed szlifem; do Ciebie dociera samo `obs: …`. Jeśli dotrze obserwacja przepisana przez szlif, zapisz to jako BŁĄD.
- **Każda inna wiadomość** (poza slash-komendami) to **wejście testowe**. Odpowiedz tylko tak:
  ````
  ODEBRANO (krok N):
  ```
  <dokładnie tekst, który dostałeś, znak w znak>
  ```
  Długość: X znaków. Prefiks `-- `/`++ `/`!model` w tekście: tak/nie.
  ````
  Potem jednym zdaniem: czego oczekiwał ten krok i czy to, co dostałeś, się zgadza. Na końcu następny krok z tabeli.
- Po każdym kroku dopisz wiersz do `TEST-REPORT.md` (sekcja „Kroki”): krok, co wpisano, co odebrałeś, obserwacje, wynik OK / BŁĄD / NIEJASNE.
- Gdy dotrze `obs: koniec`, przejdź do Części C.
- Sesję zaczynasz od kroku 1. Prowadź mnie krok po kroku, jednym krokiem naraz.

### Kroki

Ustawienia startowe: tryb **Wywiad**, wysyłka **Podgląd** (domyślne). Jeśli `/szlif status` pokaże co innego, najpierw `/szlif wywiad` i `/szlif podglad`.

| Krok | Co robi użytkownik | Oczekiwane |
| --- | --- | --- |
| 0 | (przed wklejeniem prowadzącego) Patrzy na ekran po starcie. | Pasek statusu: `✎ szlif: wywiad · podgląd`. Kokpit z sekcją **SZLIF PROMPTU**: `● Wywiad`, `● Podgląd`, „dopytuje, gdy czegoś ważnego brakuje”. Brak szarych linii z błędem modu w transkrypcie. |
| 1 | Wkleja prompt prowadzącego zaczynający się od `-- `. | Prompt idzie bez szlifu (prowadzący dostał tekst bez `-- `). Brak fazy „czytam prompt…”. |
| 2 | `Uruchom npm test w tym folderze i pokaż mi wynik, niczego nie zmieniaj.` | Krótko „czytam prompt…”, potem toast „prompt jest dobry”. Prowadzący odbiera tekst identyczny z wpisanym. Jeśli szlif go jednak poprawił, zapisz to jako NIEJASNE (ocena modelu, nie błąd kodu). |
| 3 | Klika **Szlif** w Kokpicie. | Przycisk `● Szlif` aktywny, opis „poprawia prompt bez pytań”, pasek statusu `✎ szlif: szlif · podgląd`. |
| 4 | `popraw walidację w login.ts bo nie działa dobrze` | Pasek i Kokpit pokazują „czytam prompt…”. Prompt **nie** idzie do prowadzącego; poprawiona wersja ląduje w polu, toast „popraw w polu albo wyślij Enterem”. W Kokpicie „Ostatnio: …”. Wersja nie wymyśla nieistniejących plików ani wymagań spoza promptu. |
| 5 | Dopisuje na końcu pola `Bez nowych zależności.` i wciska Enter. | Prowadzący odbiera poprawioną wersję z dopiskiem. Szlif **nie** szlifuje jej drugi raz (brak „czytam prompt…”). |
| 6 | Klika **Przywróć oryginał** w Kokpicie, potem Enter. | W polu pojawia się `popraw walidację w login.ts bo nie działa dobrze`. Prowadzący odbiera dokładnie ten tekst, bez szlifu. |
| 7 | Klika **Wywiad**. Wpisuje `dodaj logowanie do aplikacji`. | Okno pytań (1–3 pytania, nagłówek, 2–4 opcje i pole na własną odpowiedź). Na pierwsze wybiera opcję, na drugie (jeśli jest) wpisuje własną odpowiedź. Potem „składam prompt…”, gotowy prompt w polu zawiera obie odpowiedzi. Wysyła Enterem. |
| 8 | `zrób eksport danych do pliku` i wciska **Esc** na pierwszym pytaniu. | Pozostałe pytania się nie pojawiają. Prompt i tak trafia do pola (złożony bez odpowiedzi). Wysyła Enterem. |
| 9 | Klika **Wył**. Wpisuje `napisz test jednostkowy dla funkcji login w src/login.ts`. | Pasek statusu znika. Prompt idzie jak wpisany. |
| 10 | `++ dodaj cache do funkcji exportData` (tryb nadal Wył). | Mimo trybu Wył jest wywiad (okno pytań), potem prompt w polu bez `++`. Wysyła Enterem. |
| 11 | Klika **Szlif**, potem **Auto**. Wpisuje `popraw komentarz w login.ts`. | Brak wstawiania do pola: prowadzący od razu odbiera poprawioną wersję. Toast „wysłano poprawiony prompt … /szlif cofnij wstawi oryginał”. |
| 12 | `/szlif cofnij` (nie wysyła pola, tylko opisuje w `-- obs:`, co widzi). Następnie czyści pole. | W polu oryginał `popraw komentarz w login.ts`. |
| 13 | `!sonnet przetłumacz komentarze w login.ts na polski` (Szlif + Auto). | Toast model-hint, że tura idzie na Sonnet (wymuszone). Prowadzący odbiera poprawioną wersję, bez `!sonnet` (model-hint go zdejmuje). Prowadzący podaje, jakim jest modelem. Jeśli wpisanie `!` na początku przełącza pole w tryb bash, zapisz to jako BŁĄD prefiksów model-hint. |
| 14 | `-- napisz 60 ponumerowanych linijek dowolnego tekstu`, a **w trakcie** odpowiedzi wpisuje `sprawdź też czy eksport obsługuje puste dane` i Enter. | Prompt wpisany w trakcie tury idzie jak wpisany (bez szlifu, bez wstawiania do pola). |
| 15 | `tak`, potem `/szlif status`. | `tak` idzie bez szlifu. Status pokazuje tryb, wysyłkę i liczniki (poprawione, po wywiadzie, dobre od razu), zgodne z dotychczasowym przebiegiem. |
| 16 | Klika **Podgląd**. Wkleja dowolny obrazek ze schowka i dopisuje `opisz co jest na tym obrazku i zapisz opis do README`. | Toast „Szlif pominięty: prompt ma załączniki…”, prompt z obrazkiem idzie jak wpisany. |
| 17 | `przenieś funkcję login do osobnego modułu auth` i wciska **Esc**, gdy widać „czytam prompt…”. | Zapisać, co się stało: czy prompt przepadł, wrócił do pola, czy poszedł. Pasek statusu po chwili wraca do normalnego stanu (nie zostaje „czytam prompt…”). |
| 18 | `/szlif` trzy razy. | Tryb przechodzi po kolei; Kokpit od razu pokazuje aktywny przycisk zgodny z każdą odpowiedzią komendy. |
| 19 | Zawęża okno poniżej 144 kolumn i wpisuje `/kokpit`. | Sekcja SZLIF PROMPTU czytelna, przyciski się zawijają, nic nie ucieka poza panel. |
| 20 | Ustawia `Szlif` + `Podgląd`, zamyka sesję (`/exit`), startuje ją od nowa tą samą komendą, wkleja prowadzącego jeszcze raz (z `-- `) i pisze `-- obs: po restarcie`. | Po restarcie tryb i wysyłka są zapamiętane: pasek `✎ szlif: szlif · podgląd`, Kokpit zgodny. |
| 21 (opcjonalnie) | `/config` → szlif → „Kto szlifuje” = `fork`. Powtarza krok 4. Potem wraca na `sonnet`. | Poprawka bardziej zgodna z rozmową; działa tak samo jak w kroku 4. Zużywa limit modelu sesji. |
| 22 (opcjonalnie) | Zakładka Code w aplikacji Claude Desktop z tymi samymi modami: powtarza kroki 4 i 7. | Okno pytań i wstawianie do pola działają na desktopie; jeśli pole jest niedostępne, poprawiony prompt pojawia się w transkrypcie. |

---

## Część C: raport (dla prowadzącego, po `-- obs: koniec`)

1. Znajdź log debug tej sesji (najnowszy plik w `%USERPROFILE%\.claude\debug\` albo ścieżka, którą podaje `/status` lub `/doctor`). Wyciągnij wszystkie linie zawierające `szlif`, `kokpit`, `model-hint`, `hook`, `refused`, `skipped`, `ui.render`. Zapisz je w sekcji „Log debug” (bez powtórzeń, najwyżej 80 linii).
2. Ponownie odpal `claude plugin validate` i `claude plugin test` dla `szlif` i `kokpit`. Dopisz wynik.
3. Uzupełnij `TEST-REPORT.md`:
   - **Podsumowanie**: ile kroków OK / BŁĄD / NIEJASNE.
   - **Kroki**: tabela `Krok | Oczekiwane | Wynik | Status | Notatki`.
   - **Błędy**: dla każdego BŁĘDU: objaw, kroki do odtworzenia, pasujące linie z logu i Twoja hipoteza przyczyny ze wskazaniem pliku i funkcji w `mods\szlif\hooks\` albo `mods\kokpit\hooks\`. Nie poprawiaj kodu.
   - **Jakość szlifu**: dla kroków 4, 7, 8, 11: oryginał, wynik i ocena (czy zachował intencję, czy coś zmyślił, czy pytania były trafne).
   - **Środowisko**: wersja Claude Code, system, szerokość terminala, które mody były załadowane i skąd.
4. Na koniec napisz mi ścieżkę raportu i trzy najważniejsze problemy.

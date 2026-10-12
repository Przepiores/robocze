# szlif: ulepszanie promptu przed wysłaniem

Mod do Claude Code, który łapie Twój prompt po wciśnięciu Entera, zanim trafi do Claude'a. Model czyta go razem z kontekstem sesji i robi jedno z trzech:

| Ocena | Co się dzieje |
| --- | --- |
| **ok** | Prompt jest jasny. Idzie bez zmian, toast „prompt jest dobry”. |
| **popraw** | Cel jest jasny, ale brakuje zakresu, kryterium ukończenia, ograniczeń albo kontekstu z rozmowy. Dostajesz poprawioną wersję. |
| **pytaj** | Brakuje czegoś, bez czego wynik łatwo pójdzie w złą stronę. Najpierw pada do 3 pytań w oknie wyboru (z gotowymi opcjami i polem na własną odpowiedź), potem z odpowiedzi powstaje prompt. |

```
Ty:     dodaj walidację formularza logowania
Szlif:  [Błędy]  Gdzie pokazywać błędy?        ( Pod polem | Toast | Inne… )
        [Hasło]  Jakie reguły hasła?           ( Min. 8 znaków | Bez reguł | Inne… )
W polu: Dodaj walidację formularza logowania: e-mail i hasło wymagane, błędy pod polem,
        hasło min. 8 znaków. Gotowe, gdy testy formularza przechodzą.
```

Zasady, których trzyma się model: zachowuje Twój cel i zakres (nie dopisuje funkcji), pisze po Twojemu w pierwszej osobie, długość dopasowuje do zadania, dosłownie zostawia ścieżki, `@pliki`, kod i komendy, nazwy bierze tylko z promptu i kontekstu, bez ozdobników typu „jesteś ekspertem”.

## Tryby i przełączanie

| Tryb | Działanie |
| --- | --- |
| **Wył** | Prompty idą jak wpisane. |
| **Szlif** | Poprawia bez pytań. Gdy czegoś brakuje, przyjmuje najbardziej prawdopodobne założenie i zapisuje je w prompcie jako „Założenie: …”. |
| **Wywiad** (domyślny) | Jak szlif, ale gdy brakuje czegoś ważnego, najpierw dopytuje. |

| Wysyłka | Działanie |
| --- | --- |
| **Podgląd** (domyślna) | Poprawiony prompt wraca do pola. Poprawiasz albo wysyłasz Enterem (drugi raz już nie jest szlifowany). |
| **Auto** | Poprawiony prompt od razu idzie do Claude'a. |

Przełączanie:
- **Kokpit**: sekcja „SZLIF PROMPTU” z przyciskami `Wył · Szlif · Wywiad` i `Podgląd · Auto`, faza pracy na żywo, ostatnia zmiana i **Przywróć oryginał**. Sekcja pojawia się sama, gdy oba mody są włączone.
- `/szlif` bez argumentu przełącza tryb po kolei: wył → szlif → wywiad.
- `/szlif off|szlif|wywiad`, `/szlif podglad|auto`, `/szlif cofnij` (oryginał z powrotem w polu), `/szlif status`.
- Na jeden prompt: `-- ` na początku wysyła bez szlifu, `++ ` robi wywiad nawet przy trybie Wył.
- Tryb i wysyłka są pamiętane między sesjami. W pasku statusu widać `✎ szlif: wywiad · podgląd`.

## Kiedy szlif nic nie robi

- Slash-komendy, krótkie odpowiedzi i kontynuacje („tak”, „dalej”, „zrób to”), prompty poniżej 20 znaków.
- Prompt wpisany w trakcie tury (dopowiedzenie do pracy, która już trwa).
- Prompt wysłany przez inny mod, zaplanowane zadanie albo inną sesję.
- Prompt z obrazem lub załącznikiem w trybie Podgląd (załącznika nie da się wstawić z powrotem do pola).
- Model nie odpowiedział albo odpowiedział nie na temat: prompt idzie jak wpisany, z toastem.
- Esc w oknie pytania pomija resztę wywiadu, prompt i tak jest składany z tego, co wiadomo.

## Kto szlifuje

W `/config` albo w `settings.json`:

```json
{ "pluginConfigs": { "szlif": { "mode": "wywiad", "deliver": "podglad", "model": "sonnet" } } }
```

| `model` | Kontekst | Koszt |
| --- | --- | --- |
| `sonnet` (domyślnie) | lekki: nazwa projektu, główny katalog, pliki zmienione w sesji, poprzedni prompt i końcówka odpowiedzi | 1 zapytanie na prompt, 2 przy wywiadzie |
| `haiku` | jak wyżej | taniej, słabsze pytania |
| `fork` | model sesji z całą rozmową (najlepiej rozumie, o co chodzi) | zjada limit modelu sesji, np. Opusa; pierwszy prompt sesji idzie przez Sonneta |

## Z innymi modami

- **model-hint**: prefiks `!opus`, `!sonnet`, `!haiku` zostaje na początku poprawionego promptu. W trybie Auto przełączanie modelu działa jak zwykle; w Podglądzie model-hint ocenia prompt dopiero po Twoim Enterze.
- **kokpit**: przyciski i podgląd stanu (patrz wyżej). Kokpit zapisuje prośbę pod własną nazwą (`kokpit.szlifAsk`), a szlif ją obserwuje, bo każdy mod zmienia tylko swój stan.

## Instalacja

```
claude --plugin-dir C:\ścieżka\do\robocze\mods\szlif --plugin-dir C:\ścieżka\do\robocze\mods\kokpit
```

Sprawdzenie i testy:
```
claude plugin validate mods/szlif
claude plugin test mods/szlif
```

## Pliki

| Plik | Co robi |
| --- | --- |
| `.claude-plugin/plugin.json` | Manifest i ustawienia `mode`, `deliver`, `model` |
| `hooks/register.ts` | Hooki: `prompt.submit` (szlif, wywiad, podgląd/auto), `tool.call` i `turn.complete` (kontekst), `state.set` na `kokpit.szlifAsk`, komenda `/szlif` |
| `hooks/logic.ts` | Znaczniki `--`/`++`, filtr promptów, prompty dla modelu, parsowanie JSON, kanał Kokpitu |
| `hooks/register.test.ts` | Testy logiki, podglądu, auto, wywiadu, przepuszczania, `/szlif` i kanału Kokpitu (20) |
| `types/index.d.ts` | Kontrakt stanu `szlif.status` i typ prośby z Kokpitu |
| `TESTING.md` | Test na żywo szlifu i Kokpitu w Claude Code: przygotowanie, 22 kroki, raport |

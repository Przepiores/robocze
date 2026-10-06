export const NEXT_SYSTEM = `Proponujesz użytkownikowi Claude Code trzy następne prompty po ostatniej odpowiedzi.

Zasady:
- Zwróć dokładnie 3 linie i nic więcej: bez numeracji, punktorów, cudzysłowów i komentarzy.
- Każda linia to gotowy prompt do wysłania, po polsku, w trybie rozkazującym, najwyżej 80 znaków.
- Konkretnie: nazywaj pliki, funkcje i komendy z rozmowy, nie pisz ogólników typu „kontynuuj”.
- Postaraj się o różne rodzaje kroków, jeśli pasują: dalsza praca, sprawdzenie (testy, przegląd), domknięcie (commit, dokumentacja).
- Jeśli rozmowa nie dotyczy kodu, zaproponuj sensowne pytania lub kroki w jej temacie.`

/** What the small model reads to propose the next three prompts. */
export function nextPrompt(input: { prompt: string; answer: string; files: readonly string[]; handoffNext: readonly string[] }): string {
  const answer = input.answer.length > 1500 ? `…${input.answer.slice(-1500)}` : input.answer
  const parts = [
    `Ostatni prompt użytkownika:\n${input.prompt.slice(0, 600)}`,
    `Ostatnia odpowiedź Claude'a (końcówka):\n${answer}`,
  ]
  if (input.files.length > 0) parts.push(`Pliki zmienione w tej sesji: ${input.files.join(', ')}`)
  if (input.handoffNext.length > 0) parts.push(`Następne kroki z ostatniego handoffu projektu:\n${input.handoffNext.map(s => `- ${s}`).join('\n')}`)
  return parts.join('\n\n')
}

/** Three clean prompts from the model's reply; numbering, bullets and quotes stripped. */
export function parseSuggestions(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/^["„“']+|["”“']+$/g, '').trim())
    .filter(l => l.length >= 3)
    .map(l => (l.length > 120 ? `${l.slice(0, 119)}…` : l))
    .slice(0, 3)
}

# Ukeplanlegger

En statisk webapp som fordeler oppgaver i ledig tid mellom forelesninger, og viser om du rekker fristene dine.

- Timeplan, fag, oppgaver (Fag / Jobbsøking / Intervjuøving), eksamener og ukemål for intervjuøving
- Planen fordeles automatisk: 08–21 minus timeplan, maks 6 t oppgaver per dag, blokker på maks 2 t
- Fristradar, «Nå / neste økt», avkrysning av ferdige oppgaver og eksport til kalender (.ics)
- Data lagres kun i nettleseren (localStorage). Ingen backend, innlogging eller API-nøkler.

## Kjøre

Åpne `index.html` i en nettleser, eller bruk GitHub Pages (Settings → Pages → branch `main`, mappe `/`).

## Tester

Planleggingslogikken er en ren funksjon i `planner.js` og testes uten nettleser:

```
node --test tests/planner.test.js
```

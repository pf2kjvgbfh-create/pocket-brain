# Shortcut payload: what the app sends to «Мозг-напомнить»

The Shortcut on the phone is built by hand (`SETUP.md`, section 4) and cannot be updated from code.
This format therefore must not change without updating `SETUP.md` section 4 in the same change.
Code: `src/shortcut/payload.ts`. Tests: `tests/shortcut.test.ts`, `e2e/shortcut.spec.ts`.

## URL

```
shortcuts://run-shortcut?name=<encodeURIComponent('Мозг-напомнить')>&input=text&text=<encodeURIComponent(JSON)>
```

- The name comes from `SHORTCUT_NAME` in `src/config.ts`.
- Built with `encodeURIComponent` only (`URLSearchParams` would turn spaces into `+`). The `text` part never contains a raw `&`, `+`, `#`, `%`, quote or space.
- The button is a plain link (`<a href="shortcuts://…">`, `data-action="remind"`), shown only for a reminder or subscription that has a date.
- Stage 2b: the page also opens this same URL BY ITSELF when the toast's undo window (`UNDO_MS`, 5 s) passes: a hidden `<a data-action="remind-auto">` is added, clicked and removed (`openShortcut` in `src/ui/remind.ts`). It does not happen after «Отменить» / «Изменить», after a newer phrase, for «Уже записано», or for a draft restored after a reload. If the owner leaves the page before 5 s, nothing opens and the button stays in «Дела».

## JSON

Exactly five fields, always all present:

```json
{
  "title": "позвонить маме — 19:00 МСК",
  "due": "2026-10-23T19:00:00+03:00",
  "due_local": "2026-10-23 21:00",
  "due_msk": "23.10 19:00 МСК",
  "repeat": "none"
}
```

| Field | Meaning |
| --- | --- |
| `title` | `<record title or raw text> — HH:MM МСК` (the Moscow clock time of `due`, so it stays visible in «Напоминаниях» whatever the phone does with the date). The key and the five-field shape did not change. |
| `due` | The reminder instant, ISO 8601, seconds included, always with the fixed offset `+03:00` (Moscow), whatever zone the phone is in. This is the field the Shortcut reads. |
| `due_local` | The SAME instant in the phone's own time zone, `YYYY-MM-DD HH:mm`. See below. |
| `due_msk` | The same instant for a human, as the app shows it: `DD.MM HH:mm МСК` (`DD.MM.YYYY HH:mm МСК` when the year is not the current MSK year). Not used by the Shortcut. |
| `repeat` | `none` for a reminder, `monthly` for a subscription. |

For a subscription the date is its NEXT occurrence (the next day-of-month at 12:00 MSK unless a time was said), the same value the «Дела» list shows.

## Why `due_local` exists

If «Получить даты из входных данных» in Shortcuts ignores the `+03:00` offset and reads the time as phone-local, the reminder lands at the wrong hour. Then the owner switches the Shortcut to read `due_local` instead of `due` (SETUP section 4, step 4) and the app format stays unchanged. Whether Shortcuts honours the offset is only verifiable on the iPhone.

## `repeat`

Carried in the payload, but the MVP Shortcut ignores it: a subscription gets one reminder for the nearest date.

## Not changing the format

Do not rename, remove or reorder meaning of these fields, and do not change the offset or the `due_local` pattern, without updating `SETUP.md` section 4 and telling the owner to rebuild the Shortcut.

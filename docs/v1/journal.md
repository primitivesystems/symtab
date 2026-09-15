# Use the journal

Open **Journal** from the activity bar. You can also choose **Workspace → Calendar**.

## Daily notes

Choose a date in the calendar to make it active. Opening today’s note creates it when needed, using the configured daily folder and template. By default, daily notes live in `Daily/` and use `YYYY-MM-DD.md` filenames.

On macOS, the menu-bar quick actions include **Open Today’s Note**. The application menu also provides **Navigate → Today’s Note**.

## Weekly notes

Select a date and choose **Open week**. By default, weekly notes live in `Daily/Weekly/` and use ISO week filenames such as `2026-W37.md`.

## Additional journal entries

1. Select a date.
2. Choose **New entry**.
3. Enter a title and optional comma-separated tags.
4. Choose **Create entry**.

Additional entries are Markdown files stored under `Daily/<date>/`. Their frontmatter includes `type: journal`, the selected date, and the tags you entered.

Use the calendar filter to show journals, other dated notes, or a selected tag. Any Markdown note with a valid `date: YYYY-MM-DD` frontmatter property can appear on the calendar.

## Configure journal paths

Open **Settings → Daily Notes** to change daily and weekly folders, filename formats, templates, the Quick Capture folder, and the IANA time zone. These settings are stored per vault in `.flux/config.json`.

Templates can contain `{{date}}`; weekly templates can also contain `{{week}}`. A configured template must already exist in the vault.

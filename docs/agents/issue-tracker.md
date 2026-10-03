# Issue tracker: GitHub

Issues and specs live in aaron-howard/software-factory.
Use the gh CLI with --repo aaron-howard/software-factory.

- Publish specs: gh issue create --title "..." --body-file <file> --label ready-for-agent
- Read: gh issue view <number> --comments
- List: gh issue list --state open
- Comment: gh issue comment <number> --body-file <file>
- Label: gh issue edit <number> --add-label "..." or --remove-label "..."
- Close: gh issue close <number>

For each command, supply the repository argument above.
Use body files for multiline text.

## Pull requests as a triage surface
PRs as a request surface: no.

# Pull Request

Thank you for contributing to Symtab!

Please complete the sections below before requesting a review.

## Description

Provide a clear and concise description of what this Pull Request changes.

Explain:

- What was changed?
- Why was it changed?
- How does the change solve the related issue?

<!-- Describe your changes here. -->

## Related Issue

Link the issue that this Pull Request addresses.

Closes #

<!-- Example:
Closes #123
-->

## Type of Change

Select all that apply:

- [ ] Bug fix
- [ ] New feature
- [ ] UI/UX improvement
- [ ] Performance improvement
- [ ] Backend/API change
- [ ] Database/indexing change
- [ ] Desktop application change
- [ ] Web application change
- [ ] Plugin/MCP change
- [ ] Documentation
- [ ] Refactoring
- [ ] Testing
- [ ] Other

## Changes Made

List the main changes included in this Pull Request.

- 
- 
- 

## Implementation Details

If the change involves important technical decisions, architecture changes, or non-obvious implementation details, explain them here.

<!-- Explain important implementation details here. -->

## Testing

Describe how you tested your changes.

### General Testing

- [ ] Tested the functionality locally.
- [ ] Verified the existing functionality still works.
- [ ] Tested relevant edge cases.
- [ ] Checked for console or runtime errors.

### Desktop Testing

Check this section if your changes affect the desktop application.

- [ ] Tested the desktop application locally.
- [ ] Verified the affected functionality.
- [ ] Checked Electron-specific behavior where applicable.

### Web Testing

Check this section if your changes affect the web application.

- [ ] Tested the web application locally.
- [ ] Verified the affected functionality.
- [ ] Tested relevant navigation and UI behavior.
- [ ] Checked responsive behavior where applicable.

### Backend Testing

Check this section if your changes affect the Go backend.

- [ ] Started the local backend server.
- [ ] Tested the affected API or functionality.
- [ ] Verified database-related behavior where applicable.
- [ ] Tested relevant error and edge cases.
- [ ] Verified Docker Compose behavior where applicable.

## Build Verification

Before submitting the Pull Request, make sure the appropriate build completes successfully.

### Desktop

```bash
bun run build --filter=@symtab/desktop
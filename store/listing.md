# Chrome Web Store listing: paste these into the dashboard

## Store listing tab

**Name** (comes from the package): Assignee Filter for Linear

**Summary** (comes from the package): Filter Linear cycles and issue lists by person in one click, with a tiny bar of team avatars.

**Category:** Workflow & Planning (under Productivity)

**Language:** English

**Description:**

Filter any Linear cycle or issue list by person in one click, using a tiny bar of team avatars at the top of the page.

- Click an avatar to see only that person's issues
- Click more avatars to include more people, or click again to remove them
- Includes a "No assignee" option and a one-click Clear
- Hover to zoom the bar, with the person under your cursor staying in place
- Works with Linear's own filters: your status, label and other filters are kept
- Highlighted avatars follow the page, including after a reload

How to use it: install the extension, reload any open Linear tabs, then click the extension's icon and turn on "Show assignee filter".

Private by design: no account, no API key and no data leaves your browser. The extension reads your team's names and avatars from the copy Linear already keeps in your browser.

This is an independent extension. It isn't made by, affiliated with or endorsed by Linear.

**Screenshots:** upload both files from `store/screenshots/` (1280x800).

**Icon:** `icons/128.png`, if the dashboard asks for it separately.

## Privacy tab

**Single purpose:**
Adds a small bar of team avatars to Linear's cycle and issue pages, so users can filter those pages by assignee in one click.

**Permission justification, `storage`:**
Remembers whether the user has turned the "Show assignee filter" switch on. Nothing else is stored.

**Host permission justification, `https://linear.app/*`:**
Needed to show the avatar bar on Linear pages, read the team's names and avatars from Linear's local browser data, and apply the selected filter through the page's URL. The extension runs on no other site.

**Are you using remote code?** No. All code is included in the package.

**Data usage:** tick none of the data types. Names and avatars are read and displayed locally and are never sent anywhere or stored by the extension.

Tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** host `store/privacy-policy.md` somewhere public and paste the link.

## Distribution tab

**Visibility:** Public, or Unlisted if only people with the link should find it.
**Pricing:** Free.

# Meta App Review Status — Content Hub

This is a **template the admin must fill in**. This build was implemented
without access to the real Meta Business Manager / Meta App Dashboard, so the
fields below are scaffolded but blank. Fill them in before relying on the
Facebook OAuth connect flow in any environment beyond local development
against your own test Page.

## Decision rule: is Dev Mode sufficient, or is App Review required?

A Meta App in **Development Mode** can only be used by people with a role on
the app (Admin/Developer/Tester) in Meta's dashboard, connecting **their
own** Pages. Once the app needs to connect a Page belonging to someone who is
not an app-role holder, or needs permissions beyond the default
"basic"/self-only scopes, **App Review is required** before Meta will allow
the OAuth flow to succeed for that Page/permission combination in
production.

Apply this IF/ELSE rule:

```
IF the only Facebook Page(s) this app will ever connect to
   are owned by / already have an Admin/Developer/Tester role
   held by the same people who administer this Meta App
THEN
   Dev Mode is sufficient. No App Review submission needed yet.
ELSE
   App Review is required for the requested scopes
   (pages_show_list, pages_read_engagement, pages_manage_posts)
   before the connect flow will work for that Page.
```

## Fields to complete

- [ ] **Business Manager that owns the target Page(s)**:
  _______________________________________________
- [ ] **Meta App ID** (matches `FACEBOOK_APP_ID` in `.env`):
  _______________________________________________
- [ ] **Meta App current mode**: ☐ Development ☐ Live
- [ ] **Does the IF/ELSE rule above put this app in the "Dev Mode is
      sufficient" branch, or the "App Review required" branch?**
  ☐ Dev Mode sufficient ☐ App Review required
- [ ] **If App Review required — submission status**:
  ☐ Not started ☐ In progress ☐ Submitted, pending ☐ Approved ☐ Rejected
  (attach rejection reason / resubmission plan if rejected)
- [ ] **Scopes requested and their review status**:
  | Scope | Requested? | Review status |
  |---|---|---|
  | `pages_show_list` | | |
  | `pages_read_engagement` | | |
  | `pages_manage_posts` | | |
- [ ] **Redirect URI(s) registered in the Meta App dashboard** (must exactly
      match `FACEBOOK_REDIRECT_URI` in every environment's `.env`):
  _______________________________________________
- [ ] **Data Use Checkup completion status** (Meta periodically requires
      re-attestation of data use — track renewal date here):
  _______________________________________________
- [ ] **Contact/owner for this Meta App** (who to page if OAuth breaks in
      production):
  _______________________________________________

## Notes

- Review this doc whenever a new Facebook Page (outside the current
  Business Manager) needs to be connected, or when adding new scopes.
- Revisit before any Phase 2+ work that adds YouTube/TikTok/LINE — each
  platform has its own equivalent app-review process; this template's
  structure (mode decision rule + scope table + submission status) should be
  copied per platform rather than overloaded onto this one file.

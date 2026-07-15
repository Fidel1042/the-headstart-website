# Mentor Portal App: Testing Guide

The portal is now an installable web app. No app store, nothing to download. You open the website once, add it to your home screen, and from then on it opens like a normal app with its own gold TH icon.

Test everything below on your own phone before telling any mentor about it.

## Step 1: Deploy first

The app only works on the live site (theheadstartmentoring.com), never on a local preview. Push the changes, wait about a minute for Netlify to finish, then start testing.

## Step 2: Install on iPhone (Safari)

1. Open Safari and go to `theheadstartmentoring.com/mentor-portal/`
2. Log in as yourself
3. Tap the Share button (the square with an arrow, bottom centre of Safari)
4. Scroll down the share sheet and tap "Add to Home Screen"
5. It should show the gold TH icon on black and the name "Headstart". Tap "Add"
6. Find the icon on your home screen and open it

What you should see: the portal opens full screen with no Safari address bar, like a real app.

Important: it must be Safari. Chrome on iPhone cannot add proper home screen apps.

## Step 3: Install on Android (Chrome)

1. Open Chrome and go to `theheadstartmentoring.com/mentor-portal/`
2. Log in
3. Either a banner appears offering "Install app", or tap the three dots menu (top right) and choose "Add to home screen" or "Install app"
4. Confirm. The TH icon appears on the home screen
5. Open it from the icon

## Step 4: What to check inside the app

Go through this list once on each phone type:

- [ ] Log a session: pick a mentee, set the date, submit. The green success card should appear
- [ ] Mentee cards: open one, expand "Recommended structure" and "Notes", type a note and save it
- [ ] Session history: current week shows, the previous-weeks dropdown works, "Show full history" works
- [ ] Tap every nav menu item: Session Log, Mentee Info, Session History, Resources
- [ ] Tap "Light mode", check everything is still readable, tap "Dark mode" to go back
- [ ] Sign out, then sign back in. You should land back on the portal
- [ ] Nothing scrolls sideways and no button is too small to tap comfortably
- [ ] Admin only: open Admin, check the calendar, tap a session chip, try "+ Add session"

## If something looks stale or broken

The app keeps a backup copy of pages for when a mentor is offline. It always tries the internet first, so after any site update a simple close-and-reopen of the app gets the newest version.

If it still looks wrong:

1. Close the app fully (swipe it away in the app switcher)
2. Open it again
3. Still wrong? Delete the icon from the home screen, open the site in the browser again, and re-add it

## If the install option never appears

- iPhone: make sure you are in Safari, not Chrome or the LinkedIn/Instagram in-app browser
- Android: make sure you are in Chrome and logged into the page, then check the three dots menu
- Both: the site must be the live https address, not a preview

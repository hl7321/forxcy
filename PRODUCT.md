# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- The primary visitor is one specific person, addressed as “访客”. She may read a public letter and, if she chooses, use a shared access code to view the owner's current location.
- The owner writes and revises the letter, manages whether location sharing is active, and never receives the visitor's location.

## Product Purpose

Provide a calm, voluntary way for one person to read a personal message or view the owner's live location. Success means the visitor can choose either path without pressure, understand the privacy boundary, and reach the map quickly on repeat visits.

## Positioning

This is a single-person “anchor”, not a general tracking product: a public letter and a password-protected, one-way location view share one continuous experience.

## Operating Context

- The visitor usually opens the site on a phone.
- The root page presents two persistent choices: read the letter or go directly to location.
- Reading the letter does not require a password. Viewing location does.
- After the letter has been read in a browser, the location entry becomes the primary repeat-visit action while the letter remains available.
- The visitor's location is never requested or shown to the owner, and opening the site does not notify the owner.

## Capabilities and Constraints

- Existing stack: static HTML, CSS, and JavaScript; Leaflet for the map; a Python standard-library web service for authentication and state APIs.
- Existing location reporting, map polling, access-code authentication, lockout, and owner stop/start controls must keep working.
- The letter, password hint, progressive failure messages, success message, labels, and transition copy must live in one independently editable content configuration.
- Confirmed opening copy: “你好，这是一封示例信。欢迎来到这个新的锚点。”
- The letter body and transition copy are intentionally undecided and must remain empty until supplied.
- Confirmed closing intent: explain that only the owner's position is displayed, the visitor's location is not collected, opening the page sends no notification, and the site is the owner's next “anchor”.
- Confirmed password copy:
  - Initial hint: “访问码是 6 位数字，请向站主索取。” The phrase is a private mnemonic and does not refer to the owner's real phone unlock code.
  - First failure: “访问码不正确，请再试一次。”
  - Second failure: “访问码还是不对，注意位数。”
  - Third failure: “提示：访问码是 6 位数字。”
  - Success on any attempt: “验证通过，正在进入地图。”
- The public letter must not contain the access code, precise address, or other credentials.
- Search-engine exclusion may be requested through metadata, but a public URL cannot guarantee secrecy if it is shared.

## Brand Commitments

- The emotional stance is a restrained greeting after a long separation, not a request to reconnect and not a romantic-pressure experience.
- Preserve the metaphor of an “anchor” and a path that moves from words to a coordinate.
- The experience should feel free, calm, sincere, and controlled. Avoid hearts, forced nostalgia, emotional coercion, or language that demands a response.
- The visitor always retains a clear path to skip the letter and view location directly.

## Evidence on Hand

- The location-sharing application is already deployed and its end-to-end location flow has been verified.
- Existing implementation is in `static/index.html`, `static/map.html`, `static/owner.html`, and `app.py`.
- The owner has provided confirmed opening, closing intent, password hint, progressive error messages, and success message. The main letter body is not yet available and must not be fabricated.

## Product Principles

1. Choice without pressure: reading the letter is invited, never required.
2. Honest privacy: distinguish one-way location sharing from secrecy claims the system cannot guarantee.
3. Continuity with restraint: transitions connect words, password, and map without delaying the visitor's task.
4. Repeat visits stay practical: location becomes the primary action after the letter has been read.
5. Personal copy stays editable and separate from interface behavior.

## Accessibility & Inclusion

- Maintain semantic controls, keyboard access, readable contrast, and clear focus states.
- Provide an intentional reduced-motion path that preserves status and navigation feedback without spatial travel.

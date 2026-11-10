# Raffly: Instagram giveaway picker

Pick random giveaway winners from the comments on an Instagram post. Free, nothing to install, no API keys and no extra login.

**App:** https://gru-webdesign.github.io/Winner_picker/

## How it works

1. **Drag the Raffly button to your bookmarks bar.** First time only.
2. **Open the post on Instagram and click Raffly** in the bar. The comments are collected while a progress box shows on the post.
3. **Click "Open in Raffly".** The comments arrive in the app, you set the rules and draw the winners.

The bookmarklet reads the comments in your own browser, using the Instagram session you are already logged in with and the same requests Instagram makes when you scroll through comments. Nothing is sent to a third-party server. Works on desktop browsers (Chrome, Edge, Firefox, Safari).

## Rules

- Number of winners and backup winners (up to 100)
- Minimum number of tags per comment, no repeated tags, tags of yourself or the organizer don't count
- Every comment is one entry, or one entry per person, with an optional cap on entries per person
- Whether the same person can win more than once
- Follow check: manually confirm each winner, or match against the follower list from your Instagram data export
- Required word or hashtag, comment deadline, excluded accounts, replies on or off
- Several posts in one draw
- Draw code: the same code and the same comments always give the same result, so anyone can verify the draw

Results: winners, backups, text to copy, a story image (1080×1920) and a public results link to share with your followers. Your rules are remembered in the browser for the next draw.


## Note

If Instagram changes its internal requests, the bookmarklet may stop working. Its code is the `zrebBookmarklet` function at the top of `index.html`. After an update, drag the button to the bookmarks bar again.

Using the app does not by itself make a giveaway compliant. Organizers are responsible for following local giveaway laws and Instagram's promotion guidelines.

## License

[MIT](LICENSE) © 2026 Goran Grujović

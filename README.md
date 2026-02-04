# Realtor.ca Listing Tracker

A Chrome extension that tracks real estate listings in the Greater Toronto Area from realtor.ca, storing data in Google Sheets and displaying statistics on a dashboard.

## Features

- **Automatic Tracking**: Fetches listings from realtor.ca every hour
- **New Listing Detection**: Identifies newly listed properties
- **Sold/Delisted Detection**: Tracks when listings are removed from the market
- **Statistics Dashboard**: Visual display of listing metrics
- **Both Sale & Rent**: Tracks properties for sale and for rent
- **Unlimited Storage**: Uses Google Sheets (no record limits)

## Metrics Tracked

- New listings today
- New listings in last 7 days
- New listings in last 7 weeks (49 days)
- Sold/delisted today
- Total active listings
- Breakdown by listing type (sale/rent)

## Setup

### Step 1: Create Google Spreadsheet

1. Go to [sheets.google.com](https://sheets.google.com) and create a new spreadsheet
2. Rename "Sheet1" to "Listings"
3. Create a second sheet called "Daily_Stats"
4. In the "Listings" sheet, add these headers in row 1:
   ```
   MLS_Number | Price | Address | Type | First_Seen | Last_Seen | Status
   ```
5. In the "Daily_Stats" sheet, add these headers in row 1:
   ```
   Date | New_Listings | Sold_Count | Total_Active
   ```

### Step 2: Set Up Google Apps Script

1. In your spreadsheet, go to **Extensions > Apps Script**
2. Delete any existing code
3. Copy the entire contents of `google-apps-script.js` from this repo and paste it
4. Click the **Save** button
5. Click **Deploy > New deployment**
6. Select type: **Web app**
7. Set "Execute as" to **Me**
8. Set "Who has access" to **Anyone**
9. Click **Deploy**
10. Authorize when prompted (click through security warnings)
11. **Copy the Web app URL** - you'll need this!

### Step 3: Install the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. Click the extension icon
6. Paste your Google Apps Script URL
7. Click "Save Configuration"

### Step 4: Use the Dashboard

**Live Dashboard**: https://aakashpatel1995.github.io/realtor-tracker/

1. Visit the dashboard URL above
2. Click "Configure Now"
3. Paste the same Google Apps Script URL
4. Click "Save & Load Data"

## Project Structure

```
realtor-tracker/
├── extension/
│   ├── manifest.json          # Chrome extension manifest v3
│   ├── background.js          # Service worker for API calls
│   ├── popup/
│   │   ├── popup.html         # Extension popup UI
│   │   ├── popup.js           # Popup logic
│   │   └── popup.css          # Popup styles
│   └── icons/                 # Extension icons
├── docs/                      # Dashboard (GitHub Pages)
│   ├── index.html             # Standalone dashboard page
│   ├── dashboard.js           # Dashboard logic
│   └── dashboard.css          # Dashboard styles
├── google-apps-script.js      # Apps Script code for Google Sheets
└── README.md
```

## How It Works

1. **Data Collection**: The background service worker fetches listings from realtor.ca's public API endpoint every hour
2. **Sync**: Data is sent to Google Sheets via Apps Script web app
3. **Detection**: New listings are added, missing listings are marked as sold
4. **Statistics**: Daily stats are recorded for historical tracking
5. **Display**: The popup and dashboard read from Google Sheets to display metrics

## GTA Coverage

The extension tracks listings within these geographic bounds:
- Longitude: -80.0 to -78.9
- Latitude: 43.4 to 44.0

This covers most of the Greater Toronto Area including Toronto, Mississauga, Brampton, Markham, Vaughan, Richmond Hill, and surrounding areas.

## Tips

- The extension runs automatically every hour, but you can trigger a manual refresh anytime
- The dashboard can be bookmarked for quick access
- Historical data is preserved in Google Sheets for trend analysis
- You can view/edit data directly in Google Sheets

## Troubleshooting

**Extension not loading data:**
- Check that your Apps Script URL is correct (should end with `/exec`)
- Verify the Apps Script is deployed as a web app
- Check the browser console for error messages

**"Authorization required" error:**
- Re-deploy your Apps Script and authorize again
- Make sure "Who has access" is set to "Anyone"

**No listings appearing:**
- The first fetch may take a few minutes due to pagination
- Ensure you've run a manual refresh at least once
- Check that sheet names are exactly "Listings" and "Daily_Stats"

**Dashboard not updating:**
- Verify the URL is saved (check browser console)
- Try a manual refresh
- Check browser console for errors

## License

MIT License - Feel free to modify and use as needed.

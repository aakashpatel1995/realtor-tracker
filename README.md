# Realtor.ca Listing Tracker

A Chrome extension that tracks real estate listings in the Greater Toronto Area from realtor.ca, storing data in Airtable and displaying statistics on a dashboard.

## Features

- **Automatic Tracking**: Fetches listings from realtor.ca every hour
- **New Listing Detection**: Identifies newly listed properties
- **Sold/Delisted Detection**: Tracks when listings are removed from the market
- **Statistics Dashboard**: Visual display of listing metrics
- **Both Sale & Rent**: Tracks properties for sale and for rent

## Metrics Tracked

- New listings today
- New listings in last 7 days
- New listings in last 7 weeks (49 days)
- Sold/delisted today
- Total active listings
- Breakdown by listing type (sale/rent)

## Setup

### Step 1: Create Airtable Base

1. Create a free account at [airtable.com](https://airtable.com)
2. Create a new Base called "Realtor Tracker"
3. Create two tables with the following fields:

**Table: Listings**
| Field | Type |
|-------|------|
| MLS_Number | Single line text (Primary) |
| Price | Number |
| Address | Single line text |
| Type | Single select (options: sale, rent) |
| First_Seen | Date |
| Last_Seen | Date |
| Status | Single select (options: active, sold) |

**Table: Daily_Stats**
| Field | Type |
|-------|------|
| Date | Date (Primary) |
| New_Listings | Number |
| Sold_Count | Number |
| Total_Active | Number |

### Step 2: Get Airtable Credentials

1. Go to [airtable.com/account](https://airtable.com/account)
2. Create a Personal Access Token with these scopes:
   - `data.records:read`
   - `data.records:write`
3. Copy the token (starts with `pat...`)
4. Go to [airtable.com/api](https://airtable.com/api) and select your base
5. Copy the Base ID from the URL (starts with `app...`)

### Step 3: Install the Extension

1. Open Chrome and go to `chrome://extensions`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Select the `extension` folder from this project
5. Click the extension icon and enter your Airtable credentials

### Step 4: Use the Dashboard

**Live Dashboard**: https://aakashpatel1995.github.io/realtor-tracker/

1. Visit the dashboard URL above (or open `docs/index.html` locally)
2. Enter the same Airtable credentials
3. View your statistics!

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
├── docs/                        # Dashboard (GitHub Pages)
│   ├── index.html             # Standalone dashboard page
│   ├── dashboard.js           # Dashboard logic
│   └── dashboard.css          # Dashboard styles
└── README.md
```

## How It Works

1. **Data Collection**: The background service worker fetches listings from realtor.ca's public API endpoint every hour
2. **Comparison**: New listings are compared against existing records in Airtable
3. **Detection**: New listings are added, missing listings are marked as sold
4. **Statistics**: Daily stats are recorded for historical tracking
5. **Display**: The popup and dashboard read from Airtable to display metrics

## GTA Coverage

The extension tracks listings within these geographic bounds:
- Longitude: -80.0 to -78.9
- Latitude: 43.4 to 44.0

This covers most of the Greater Toronto Area including Toronto, Mississauga, Brampton, Markham, Vaughan, Richmond Hill, and surrounding areas.

## Limitations

- **Airtable Free Tier**: Limited to 1,000 records per base
- **API Rate Limits**: realtor.ca may rate-limit aggressive requests
- **Airtable API**: 5 requests/second limit

## Tips

- The extension runs automatically every hour, but you can trigger a manual refresh anytime
- The dashboard can be bookmarked for quick access
- For hosting the dashboard online, you can use GitHub Pages (free)
- Historical data is preserved in Airtable for trend analysis

## Troubleshooting

**Extension not loading data:**
- Check that your Airtable credentials are correct
- Verify the table names match exactly ("Listings" and "Daily_Stats")
- Check the browser console for error messages

**No listings appearing:**
- The first fetch may take a few minutes due to pagination
- Ensure you've run a manual refresh at least once

**Dashboard not updating:**
- Verify the credentials are saved (check localStorage)
- Try a manual refresh
- Check browser console for errors

## License

MIT License - Feel free to modify and use as needed.

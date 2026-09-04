import urllib.request
import urllib.parse
import re
import json
import subprocess

# Close Spotify first
subprocess.run(['powershell', '-Command', 'Stop-Process -Name Spotify -ErrorAction SilentlyContinue'])

# Search YouTube for guitar songs 5 hours
query = 'guitar songs 5 hours'
url = f'https://www.youtube.com/results?search_query={urllib.parse.quote(query)}'
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'})

try:
    html = urllib.request.urlopen(req).read().decode('utf-8')
    # Extract ytInitialData
    match = re.search(r'var ytInitialData = ({.*?});</script>', html)
    if match:
        data = json.loads(match.group(1))
        contents = data['contents']['twoColumnSearchResultsRenderer']['primaryContents']['sectionListRenderer']['contents'][0]['itemSectionRenderer']['contents']
        for item in contents:
            if 'videoRenderer' in item:
                v = item['videoRenderer']
                vid_id = v['videoId']
                length_str = v.get('lengthText', {}).get('simpleText', '')
                # Length string example: 5:12:30 or 10:00:00
                parts = length_str.split(':')
                if len(parts) == 3:
                    hours = int(parts[0])
                    if hours >= 5:
                        target_url = f'https://www.youtube.com/watch?v={vid_id}'
                        print(f'FOUND: {target_url} ({length_str})')
                        subprocess.run(['start', 'msedge', target_url], shell=True)
                        exit(0)
except Exception as e:
    print(f'Error: {e}')

# Fallback search URL directly in Edge if extraction failed
fallback_url = 'https://www.youtube.com/results?search_query=guitar+songs+5+hours'
subprocess.run(['start', 'msedge', fallback_url], shell=True)

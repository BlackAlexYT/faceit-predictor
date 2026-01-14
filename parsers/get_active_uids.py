import asyncio
import aiohttp
import os
import csv
from parse_matches import get_html
from datetime import datetime

api_url = "https://open.faceit.com/data/v4/"

INPUT_CSV = "dataset_ultimate.csv"
OUTPUT_CSV = "faceit_players_extracted.csv"


async def process_match(session, match_id, unique_uids):
    url = f"{api_url}matches/{match_id}"
    data = await get_html(session, url)

    if not data or 'teams' not in data:
        return

    for faction in ['faction1', 'faction2']:
        roster = data.get('teams', {}).get(faction, {}).get('roster', [])
        for player in roster:
            p_id = player.get('player_id')
            if p_id:
                unique_uids.add(p_id)


async def main():
    if not os.path.exists(INPUT_CSV):
        print(f"File {INPUT_CSV} not found!")
        return

    match_ids = []
    with open(INPUT_CSV, mode='r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get('match_id'):
                match_ids.append(row['match_id'])

    print(f"Loaded {len(match_ids)} matches.")
    unique_uids = set()

    async with aiohttp.ClientSession() as session:
        batch_size = 200
        for i in range(0, len(match_ids), batch_size):
            batch = match_ids[i: i + batch_size]

            tasks = [process_match(session, mid, unique_uids) for mid in batch]
            await asyncio.gather(*tasks)

            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] Processed {i + len(batch)} / {len(match_ids)} matches | Unique UID: {len(unique_uids)}")

            await asyncio.sleep(0.5)

    print(f"Completed. Total unique UIDS: {len(unique_uids)}")

    with open(OUTPUT_CSV, mode='w', newline='', encoding='utf-8') as f:
        writer = csv.writer(f)
        writer.writerow(['uid'])
        for uid in sorted(list(unique_uids)):
            writer.writerow([uid])

    print(f"Data successfully saved to {OUTPUT_CSV}")


if __name__ == '__main__':
    asyncio.run(main())

import asyncio
import aiohttp
import os
import csv
import time
from datetime import datetime
from parse_matches import get_html

# CONFIGURATION
game_id = "cs2"
api_url = "https://open.faceit.com/data/v4/"


OUTPUT_CSV = "testikkkk.csv"

semaphore_keyapi = asyncio.Semaphore(300)  # Approximately 25 * len(proxies)
semaphore_pubapi = asyncio.Semaphore(12)  # Approximately len(proxies)

TRACKED_COUNTRIES = ['ru', 'ua', 'pl', 'kz', 'de', 'gb', 'fi', 'se', 'dk', 'fr']


async def get_player_pre_match_stats(session, player_id, pre_match_elo, match_time):
    p_data = await get_html(session, f"{api_url}players/{player_id}")
    if not p_data:
        return None

    cs2_info = p_data.get('games', {}).get('cs2', {})
    if not cs2_info or cs2_info.get('region') != 'EU':
        return None
    country = p_data.get('country', 'other').lower()

    h_data = await get_html(session, f"{api_url}players/{player_id}/games/{game_id}/stats?limit=100")
    if not h_data or 'items' not in h_data:
        return None

    items = h_data['items']

    def calc_rec(history_slice):
        c = len(history_slice)
        if c == 0:
            return {'wr': 0, 'k': 0, 'a': 0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0}
        return {
            'wr': round(sum(1 for x in history_slice if x['stats'].get('Result') == '1') / c * 100, 1),
            'k': round(sum(int(x['stats'].get('Kills', 0)) for x in history_slice) / c, 1),
            'a': round(sum(int(x['stats'].get('Assists', 0)) for x in history_slice) / c, 1),
            'kd': round(sum(float(x['stats'].get('K/D Ratio', 0)) for x in history_slice) / c, 2),
            'adr': round(sum(float(x['stats'].get('ADR', 0)) for x in history_slice) / c, 1),
            'hs': round(sum(float(x['stats'].get('Headshots %', 0)) for x in history_slice) / c, 1),
            'd': round(sum(float(x['stats'].get('Deaths', 0)) for x in history_slice) / c, 1),
        }

    recent_50 = calc_rec(items[:50])
    recent_5 = calc_rec(items[:5])

    opp_skill_50 = 0.0
    opp_skill_5 = 0.0
    time_diff_prev = 0

    hist_data = await get_html(session, f"{api_url}players/{player_id}/history?game=cs2&limit=100")
    if hist_data and 'items' in hist_data:
        h_items = hist_data['items']

        if len(h_items) > 0:
            time_diff_prev = match_time - h_items[0]['started_at']

        h_pre_history = h_items[0: 50]
        match_opp_50 = []
        for m in h_pre_history:
            opp_faction = 'faction2' if any(
                p['player_id'] == player_id for p in m['teams']['faction1']['players']) else 'faction1'
            skills = [p.get('skill_level', 0) for p in m['teams'][opp_faction]['players'] if p.get('skill_level')]
            if skills:
                match_opp_50.append(sum(skills) / len(skills))
        if match_opp_50:
            opp_skill_50 = round(sum(match_opp_50) / len(match_opp_50), 2)

        h_pre_history = h_items[0:5]
        match_opp_5 = []
        for m in h_pre_history:
            opp_faction = 'faction2' if any(
                p['player_id'] == player_id for p in m['teams']['faction1']['players']) else 'faction1'
            skills = [p.get('skill_level', 0) for p in m['teams'][opp_faction]['players'] if p.get('skill_level')]
            if skills:
                match_opp_5.append(sum(skills) / len(skills))
        if match_opp_5:
            opp_skill_5 = round(sum(match_opp_5) / len(match_opp_5), 2)

    s_data = await get_html(session, f"{api_url}players/{player_id}/stats/{game_id}")
    if not s_data:
        return None
    lt = s_data.get('lifetime', {})
    life_pre = {
        'matches': int(lt.get('Matches', 0)),
        'wr': lt.get('Win Rate %', 0),
        'kd': lt.get('Average K/D Ratio', 0),
        'adr': lt.get('ADR', 0)
    }

    map_pre = {'Mirage': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Dust2': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Inferno': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Ancient': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Train': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Overpass': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0},
               'Nuke': {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0}, }

    for seg in s_data.get('segments', []):
        for map_name in map_pre:
            if seg['type'] == 'Map' and seg['label'].lower() == map_name.lower():
                ms = seg['stats']
                map_pre[map_name] = {
                    'matches': float(ms.get('Matches', 0)),
                    'wr': float(ms.get('Win Rate %', 0)),
                    'k': float(ms.get('Average Kills', 0)),
                    'a': float(ms.get('Average Assists', 0)),
                    'kd': float(ms.get('Average K/D Ratio', 0)),
                    'adr': float(ms.get('ADR', 0)),
                    'hs': float(ms.get('Average Headshots %', 0)),
                    'd': float(ms.get('Average Deaths', 0)),
                }

    return {
        'elo': pre_match_elo, 'country': country, 'life': life_pre,
        'rec50': recent_50, 'rec5': recent_5, 'map': map_pre,
        'opp_skill_5': opp_skill_5, 'opp_skill_50': opp_skill_50, 'time_diff': time_diff_prev
    }


async def process_match(session, m_id):
    m_data = await get_html(session, f"{api_url}matches/{m_id}")
    if not m_data or m_data.get('calculate_elo') is not True:
        return None

    internal_url = f'https://www.faceit.com/api/match/v2/match/{m_id}'
    internal_data = await get_html(session, internal_url)
    if not internal_data or 'payload' not in internal_data:
        return None

    elo_map = {}
    party_size_map = {}
    premium_map = {}

    parties = internal_data['payload']['entityCustom'].get('parties', {})
    for p_id_list in parties.values():
        size = len(p_id_list)
        for p_uid in p_id_list:
            party_size_map[p_uid] = size

    for faction in ['faction1', 'faction2']:
        for p in internal_data['payload']['teams'][faction]['roster']:
            p_id = p['id']
            elo_map[p_id] = p.get('elo', 0)

            m_list = p.get('memberships', [])
            is_prem = 1 if any(m in m_list for m in ['premium', 'plus']) else 0
            premium_map[p_id] = (is_prem, 1 if is_prem == 0 else 0)

    try:
        map_name = m_data.get('voting', {}).get('map', {}).get('pick', ['unknown'])[0]
    except:
        map_name = "unknown"

    winner = None
    s1 = None
    s2 = None

    teams = {'t1': m_data['teams']['faction1']['roster'], 't2': m_data['teams']['faction2']['roster']}
    tasks = []
    prefixes = []
    for t in ['t1', 't2']:
        for p_idx in range(5):
            p_id = teams[t][p_idx]['player_id']
            tasks.append(
                get_player_pre_match_stats(session, p_id, elo_map.get(p_id, 0), m_data.get('started_at', time.time())))
            prefixes.append(f"{t}_p{p_idx}")

    results = await asyncio.gather(*tasks)
    if None in results:
        return None

    row = {'match_id': m_id, 'winner': winner, 'team1_score': s1, 'team2_score': s2, 'map': map_name}

    for i, p_stats in enumerate(results):
        pref = prefixes[i]
        curr_p_id = teams[pref[:2]][int(pref[-1])]['player_id']
        try:
            row.update({
                # Overall player info
                f"{pref}_elo": p_stats['elo'],
                f"{pref}_party_size": party_size_map.get(curr_p_id, 1),
                f"{pref}_is_premium": premium_map.get(curr_p_id, (0, 1))[0],
                f"{pref}_is_free": premium_map.get(curr_p_id, (0, 1))[1],
                f"{pref}_time_diff": p_stats['time_diff'],

                # Lifetime statistics
                f"{pref}_life_matches": p_stats['life']['matches'],
                f"{pref}_life_wr": p_stats['life']['wr'],
                f"{pref}_life_kd": p_stats['life']['kd'],
                f"{pref}_life_adr": p_stats['life']['adr'],

                # Last 50 matches statistics
                f"{pref}_rec50_opp_skill": p_stats['opp_skill_50'],
                f"{pref}_rec50_wr": p_stats['rec50']['wr'],
                f"{pref}_rec50_kd": p_stats['rec50']['kd'],
                f"{pref}_rec50_adr": p_stats['rec50']['adr'],
                f"{pref}_rec50_hs": p_stats['rec50']['hs'],
                f"{pref}_rec50_k": p_stats['rec50']['k'],
                f"{pref}_rec50_a": p_stats['rec50']['a'],
                f"{pref}_rec50_d": p_stats['rec50']['d'],

                # Last 5 matches statistics
                f"{pref}_rec5_opp_skill": p_stats['opp_skill_5'],
                f"{pref}_rec5_wr": p_stats['rec5']['wr'],
                f"{pref}_rec5_kd": p_stats['rec5']['kd'],
                f"{pref}_rec5_adr": p_stats['rec5']['adr'],
                f"{pref}_rec5_hs": p_stats['rec5']['hs'],
                f"{pref}_rec5_k": p_stats['rec5']['k'],
                f"{pref}_rec5_a": p_stats['rec5']['a'],
                f"{pref}_rec5_d": p_stats['rec5']['d'],

                # Map statistics
                f"{pref}_mirage_matches": p_stats['map']['Mirage']['matches'],
                f"{pref}_mirage_wr": p_stats['map']['Mirage']['wr'],
                f"{pref}_mirage_kd": p_stats['map']['Mirage']['kd'],
                f"{pref}_mirage_adr": p_stats['map']['Mirage']['adr'],
                f"{pref}_mirage_hs": p_stats['map']['Mirage']['hs'],
                f"{pref}_mirage_k": p_stats['map']['Mirage']['k'],
                f"{pref}_mirage_a": p_stats['map']['Mirage']['a'],
                f"{pref}_mirage_d": p_stats['map']['Mirage']['d'],

                f"{pref}_dust2_matches": p_stats['map']['Dust2']['matches'],
                f"{pref}_dust2_wr": p_stats['map']['Dust2']['wr'],
                f"{pref}_dust2_kd": p_stats['map']['Dust2']['kd'],
                f"{pref}_dust2_adr": p_stats['map']['Dust2']['adr'],
                f"{pref}_dust2_hs": p_stats['map']['Dust2']['hs'],
                f"{pref}_dust2_k": p_stats['map']['Dust2']['k'],
                f"{pref}_dust2_a": p_stats['map']['Dust2']['a'],
                f"{pref}_dust2_d": p_stats['map']['Dust2']['d'],

                f"{pref}_nuke_matches": p_stats['map']['Nuke']['matches'],
                f"{pref}_nuke_wr": p_stats['map']['Nuke']['wr'],
                f"{pref}_nuke_kd": p_stats['map']['Nuke']['kd'],
                f"{pref}_nuke_adr": p_stats['map']['Nuke']['adr'],
                f"{pref}_nuke_hs": p_stats['map']['Nuke']['hs'],
                f"{pref}_nuke_k": p_stats['map']['Nuke']['k'],
                f"{pref}_nuke_a": p_stats['map']['Nuke']['a'],
                f"{pref}_nuke_d": p_stats['map']['Nuke']['d'],

                f"{pref}_ancient_matches": p_stats['map']['Ancient']['matches'],
                f"{pref}_ancient_wr": p_stats['map']['Ancient']['wr'],
                f"{pref}_ancient_kd": p_stats['map']['Ancient']['kd'],
                f"{pref}_ancient_adr": p_stats['map']['Ancient']['adr'],
                f"{pref}_ancient_hs": p_stats['map']['Ancient']['hs'],
                f"{pref}_ancient_k": p_stats['map']['Ancient']['k'],
                f"{pref}_ancient_a": p_stats['map']['Ancient']['a'],
                f"{pref}_ancient_d": p_stats['map']['Ancient']['d'],

                f"{pref}_overpass_matches": p_stats['map']['Overpass']['matches'],
                f"{pref}_overpass_wr": p_stats['map']['Overpass']['wr'],
                f"{pref}_overpass_kd": p_stats['map']['Overpass']['kd'],
                f"{pref}_overpass_adr": p_stats['map']['Overpass']['adr'],
                f"{pref}_overpass_hs": p_stats['map']['Overpass']['hs'],
                f"{pref}_overpass_k": p_stats['map']['Overpass']['k'],
                f"{pref}_overpass_a": p_stats['map']['Overpass']['a'],
                f"{pref}_overpass_d": p_stats['map']['Overpass']['d'],

                f"{pref}_inferno_matches": p_stats['map']['Inferno']['matches'],
                f"{pref}_inferno_wr": p_stats['map']['Inferno']['wr'],
                f"{pref}_inferno_kd": p_stats['map']['Inferno']['kd'],
                f"{pref}_inferno_adr": p_stats['map']['Inferno']['adr'],
                f"{pref}_inferno_hs": p_stats['map']['Inferno']['hs'],
                f"{pref}_inferno_k": p_stats['map']['Inferno']['k'],
                f"{pref}_inferno_a": p_stats['map']['Inferno']['a'],
                f"{pref}_inferno_d": p_stats['map']['Inferno']['d'],

                f"{pref}_train_matches": p_stats['map']['Train']['matches'],
                f"{pref}_train_wr": p_stats['map']['Train']['wr'],
                f"{pref}_train_kd": p_stats['map']['Train']['kd'],
                f"{pref}_train_adr": p_stats['map']['Train']['adr'],
                f"{pref}_train_hs": p_stats['map']['Train']['hs'],
                f"{pref}_train_k": p_stats['map']['Train']['k'],
                f"{pref}_train_a": p_stats['map']['Train']['a'],
                f"{pref}_train_d": p_stats['map']['Train']['d'],
            })
        except:
            pass
        for c in TRACKED_COUNTRIES:
            row[f"{pref}_country_{c}"] = 1 if p_stats['country'] == c else 0
        row[f"{pref}_country_other"] = 1 if p_stats['country'] not in TRACKED_COUNTRIES else 0

    return row


def save_to_csv(results):
    if not results:
        return
    file_exists = os.path.isfile(OUTPUT_CSV) and os.path.getsize(OUTPUT_CSV) > 0
    with open(OUTPUT_CSV, 'a', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=results[0].keys())
        if not file_exists:
            writer.writeheader()
        writer.writerows(results)


async def main():
    async with aiohttp.ClientSession() as session:
        print(f"[{datetime.now().strftime('%H:%M:%S')}] Пачалi")
        mid = '1-0296aefc-8757-4e10-b4d8-a2b2beaf521d'

        tasks = [process_match(session, mid)]
        batch_results = await asyncio.gather(*tasks)
        results = [r for r in batch_results if r is not None]
        if results:
            save_to_csv(results)
            print(f"  -> Added: {len(results)}")

        print(f"[{datetime.now().strftime('%H:%M:%S')}] Пакночылi")


if __name__ == '__main__':
    asyncio.run(main())

import asyncio
from typing import Any

import aiohttp
import random
import os
import csv
import time
from datetime import datetime
from fake_useragent import UserAgent
from config import api_key, proxies

# CONFIGURATION
game_id = "cs2"
api_url = "https://open.faceit.com/data/v4/"

headers = {
    "Authorization": f"Bearer {api_key}",
    "Accept": "application/json",
    "User-Agent": UserAgent().random,
    "Referer": "https://www.faceit.com/en/",
}

fake_headers = {
    "User-Agent": UserAgent().random,
    "Accept": "application/json",
    "Referer": "https://www.faceit.com/en/",
}

INPUT_CSV = "faceit_players_extracted.csv"
OUTPUT_CSV = "dataset_ultimate_plus.csv"

semaphore_keyapi = asyncio.Semaphore(220)  # Approximately 25 * len(proxies)
semaphore_pubapi = asyncio.Semaphore(12)  # Approximately len(proxies)

TRACKED_COUNTRIES = ['ru', 'ua', 'pl', 'kz', 'de', 'gb', 'fi', 'se', 'dk', 'fr']


async def get_html(session: aiohttp.ClientSession, url: str) -> dict[Any, Any] | None | Any:
    if url.startswith('https://www.faceit.com/api'):
        current_semaphore = semaphore_pubapi
        cur_headers = fake_headers
    else:
        current_semaphore = semaphore_keyapi
        cur_headers = headers

    low, high = 0.3, 0.4
    while True:
        async with current_semaphore:
            await asyncio.sleep(random.uniform(low, high))
            try:
                async with session.get(url, headers=cur_headers, proxy=proxies[random.randint(0, len(proxies) - 1)],
                                       timeout=20) as response:
                    if response.status == 200:
                        return await response.json()
                    if response.status in [429, 1015]:
                        await asyncio.sleep(60)
                        print('REQUEST LIMIT', url)
                        continue
                    return {}
            except Exception as e:
                await asyncio.sleep(5)
                print(f'EXCEPTION{e}, {url}')
                continue


def rollback_stat(current_avg, current_count, match_value):
    try:
        cur_avg = float(current_avg)
        cur_count = int(current_count)
        m_val = float(match_value)
        if cur_count <= 1: return 0.0
        res = ((cur_avg * cur_count) - m_val) / (cur_count - 1)
        return round(max(0, res), 2)
    except:
        return 0.0


async def get_player_pre_match_stats(session, player_id, target_match_id, map_name, pre_match_elo):
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
    target_idx = next((i for i, m in enumerate(items) if m['stats']['Match Id'] == target_match_id), -1)
    if target_idx == -1:
        return None

    m_perf = items[target_idx]['stats']

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

    recent_50 = calc_rec(items[target_idx + 1: target_idx + 51])
    recent_5 = calc_rec(items[target_idx + 1: target_idx + 6])

    opp_skill_50 = 0.0
    opp_skill_5 = 0.0
    time_diff_prev = 0

    hist_data = await get_html(session, f"{api_url}players/{player_id}/history?game=cs2&limit=100")
    if hist_data and 'items' in hist_data:
        h_items = hist_data['items']
        h_target_idx = next((i for i, m in enumerate(h_items) if m['match_id'] == target_match_id), -1)

        if len(h_items) > h_target_idx + 1:
            time_diff_prev = h_items[h_target_idx]['started_at'] - h_items[h_target_idx + 1]['started_at']

        h_pre_history = h_items[h_target_idx + 1: h_target_idx + 51]
        match_opp_50 = []
        for m in h_pre_history:
            opp_faction = 'faction2' if any(
                p['player_id'] == player_id for p in m['teams']['faction1']['players']) else 'faction1'
            skills = [p.get('skill_level', 0) for p in m['teams'][opp_faction]['players'] if p.get('skill_level')]
            if skills:
                match_opp_50.append(sum(skills) / len(skills))
        if match_opp_50:
            opp_skill_50 = round(sum(match_opp_50) / len(match_opp_50), 2)

        h_pre_history = h_items[h_target_idx + 1: h_target_idx + 6]
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
    lt_m = int(lt.get('Matches', 0))
    m_res = 100 if m_perf.get('Result') == '1' else 0
    life_pre = {
        'matches': lt_m - 1,
        'wr': rollback_stat(lt.get('Win Rate %', 0), lt_m, m_res),
        'kd': rollback_stat(lt.get('Average K/D Ratio', 0), lt_m, m_perf.get('K/D Ratio', 0)),
        'adr': rollback_stat(lt.get('ADR', 0), lt_m, m_perf.get('ADR', 0))
    }

    map_pre = {'matches': 0, 'wr': 0.0, 'k': 0.0, 'a': 0.0, 'kd': 0.0, 'adr': 0.0, 'hs': 0.0, 'd': 0.0}
    for seg in s_data.get('segments', []):
        if seg['type'] == 'Map' and seg['label'].lower() in map_name.lower():
            ms = seg['stats']
            ms_m = int(ms.get('Matches', 0))
            map_pre = {
                'matches': ms_m - 1,
                'wr': rollback_stat(ms.get('Win Rate %', 0), ms_m, m_res),
                'k': rollback_stat(ms.get('Average Kills', 0), ms_m, m_perf.get('Kills', 0)),
                'a': rollback_stat(ms.get('Average Assists', 0), ms_m, m_perf.get('Assists', 0)),
                'kd': rollback_stat(ms.get('Average K/D Ratio', 0), ms_m, m_perf.get('K/D Ratio', 0)),
                'adr': rollback_stat(ms.get('ADR', 0), ms_m, m_perf.get('ADR', 0)),
                'hs': rollback_stat(ms.get('Average Headshots %', 0), ms_m, m_perf.get('Headshots %', 0)),
                'd': rollback_stat(ms.get('Average Deaths', 0), ms_m, m_perf.get('Deaths', 0)),
            }
            break

    return {
        'elo': pre_match_elo, 'country': country, 'life': life_pre,
        'rec50': recent_50, 'rec5': recent_5, 'map': map_pre,
        'opp_skill_5': opp_skill_5, 'opp_skill_50': opp_skill_50, 'time_diff': time_diff_prev
    }


async def process_match_leakfree(session, player_id):
    history = await get_html(session, f"{api_url}players/{player_id}/history?game=cs2&limit=1")
    if not history or not history.get('items'):
        return None
    m_basic = history['items'][0]
    m_id = m_basic['match_id']
    if m_basic['finished_at'] < (time.time() - 30 * 60):
        return None

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

    winner = 0 if m_data['results']['winner'] == 'faction1' else 1
    s1 = m_data['results']['score']['faction1']
    s2 = m_data['results']['score']['faction2']

    teams = {'t1': m_data['teams']['faction1']['roster'], 't2': m_data['teams']['faction2']['roster']}
    tasks = []
    prefixes = []
    for t in ['t1', 't2']:
        for p_idx in range(5):
            p_id = teams[t][p_idx]['player_id']
            tasks.append(get_player_pre_match_stats(session, p_id, m_id, map_name, elo_map.get(p_id, 0)))
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
                f"{pref}_map_matches": p_stats['map']['matches'],
                f"{pref}_map_wr": p_stats['map']['wr'],
                f"{pref}_map_kd": p_stats['map']['kd'],
                f"{pref}_map_adr": p_stats['map']['adr'],
                f"{pref}_map_hs": p_stats['map']['hs'],
                f"{pref}_map_k": p_stats['map']['k'],
                f"{pref}_map_a": p_stats['map']['a'],
                f"{pref}_map_d": p_stats['map']['d'],

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
    if not os.path.exists(INPUT_CSV):
        return
    with open(INPUT_CSV, 'r') as f:
        uids = [r['uid'] for r in csv.DictReader(f)]
    async with aiohttp.ClientSession() as session:
        batch_size = 1000
        for i in range(0, len(uids), batch_size):
            batch = uids[i: i + batch_size]
            print(
                f"[{datetime.now().strftime('%H:%M:%S')}] Processing batch {i // batch_size + 1}/{len(uids) // batch_size}...")

            tasks = [process_match_leakfree(session, uid) for uid in batch]
            batch_results = await asyncio.gather(*tasks)
            results = [r for r in batch_results if r is not None]
            if results:
                save_to_csv(results)
                print(f"  -> Added matches to dataset: {len(results)}")

        await asyncio.sleep(3)


if __name__ == '__main__':
    asyncio.run(main())

"""AivisSpeech / VOICEVOX でアファメーション文例とガイド音声を一括生成する。

使い方（AivisSpeech または VOICEVOX を起動しておく）:
  python tools/generate_audio.py --list                         # 声の一覧
  python tools/generate_audio.py --samples                      # 声の聞き比べ用サンプルを samples/ に作る
  python tools/generate_audio.py --speaker 888753763 --voice-name "まお（おちつき）"   # 本番生成
  python tools/generate_audio.py --engine voicevox --speaker 13 --voice-name "青山龍星" --speed 0.85 --pitch -0.03 --intonation 0.9

data.js の AFFIRMATION_TEMPLATES と GUIDE_SCRIPTS を読み、audio/ に mp3 と manifest.json を書き出す。
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
ENGINES = {'aivis': ('http://127.0.0.1:10101', 'AivisSpeech'), 'voicevox': ('http://127.0.0.1:50021', 'VOICEVOX')}
API = ENGINES['aivis'][0]

# 聞き比べ候補（クレジット必須・再配布禁止のモデルは除外）
SAMPLE_VOICES = [
    ('まお（おちつき）', 888753763),
    ('まお（ノーマル）', 888753760),
    ('コハク（ノーマル）', 1878365376),
    ('凛音エル（ノーマル）', 1388823424),
    ('るな', 345585728),
    ('花音', 1325133120),
    ('桜音', 376644064),
    ('阿井田 茂（Calm）', 1310138977),
    ('MarkN', 258599616),
    ('morioki', 497929760),
]
SAMPLE_TEXT = 'おはようございます。私は、今の自分を大切にしています。深く呼吸するたびに、心が落ち着いていきます。'


def read_data():
    src = (ROOT / 'data.js').read_text(encoding='utf-8')
    affs = re.findall(r"\{ id: '(\w+)', theme: '\w+', text: '([^']+)' \}", src)
    guide_block = src[src.index('const GUIDE_SCRIPTS'):src.index('};', src.index('const GUIDE_SCRIPTS'))]
    guides = re.findall(r"^\s+(\w+):\s+'([^']+)',", guide_block, re.M)
    return affs, guides


def api(path, params, body=None):
    url = f'{API}{path}?{urllib.parse.urlencode(params)}'
    data = json.dumps(body).encode() if body is not None else b''
    req = urllib.request.Request(url, data=data, method='POST', headers={'Content-Type': 'application/json'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read()


def synth(text, speaker, out_mp3, speed=0.92, pause_after=0.6, pitch=None, intonation=None):
    query = json.loads(api('/audio_query', {'text': text, 'speaker': speaker}))
    query['speedScale'] = speed
    if pitch is not None:
        query['pitchScale'] = pitch
    if intonation is not None:
        query['intonationScale'] = intonation
    query['prePhonemeLength'] = 0.15
    query['postPhonemeLength'] = pause_after
    wav = api('/synthesis', {'speaker': speaker}, query)
    out_mp3.parent.mkdir(parents=True, exist_ok=True)
    # 小さく軽い mp3（モノラル）に変換し、音量をそろえる
    subprocess.run(
        ['ffmpeg', '-y', '-loglevel', 'error', '-i', '-', '-ac', '1', '-ar', '44100',
         '-af', 'loudnorm=I=-18:TP=-2', '-b:a', '96k', str(out_mp3)],
        input=wav, check=True)
    return hashlib.md5(out_mp3.read_bytes()).hexdigest()[:8]


def list_voices():
    for sp in json.load(urllib.request.urlopen(f'{API}/speakers')):
        print(sp['name'], [(s['name'], s['id']) for s in sp['styles']])


def make_samples():
    out = ROOT / 'samples'
    for name, sid in SAMPLE_VOICES:
        path = out / f'{name}.mp3'
        synth(SAMPLE_TEXT, sid, path)
        print('sample:', path.name)


def generate(speaker, voice_name, engine='AivisSpeech', speed=None, pitch=None, intonation=None):
    """speed を指定すると、文例・ガイドともにその話速（短い合図は少しだけ遅く）で作る。"""
    affs, guides = read_data()
    tone = {'pitch': pitch, 'intonation': intonation}
    manifest_path = ROOT / 'audio' / 'manifest.json'
    manifest = json.loads(manifest_path.read_text(encoding='utf-8')) if manifest_path.exists() else {}
    manifest.update({'voice': voice_name, 'engine': engine, 'speaker': speaker, 'affirmations': {}, 'guide': {}})
    manifest.setdefault('bgm', [])
    for aid, text in affs:
        rel = f'audio/affirmations/{aid}.mp3'
        h = synth(text, speaker, ROOT / rel, speed=speed or 0.88, pause_after=0.8, **tone)
        manifest['affirmations'][aid] = f'{rel}?v={h}'
        print('affirmation', aid, text)
    for key, text in guides:
        rel = f'audio/guide/{key}.mp3'
        short = len(text) <= 8   # 「吸って」などの短い合図
        sp = (speed * 0.95 if short else speed) if speed else (0.85 if short else 0.9)
        h = synth(text, speaker, ROOT / rel, speed=sp, pause_after=0.2 if short else 0.7, **tone)
        manifest['guide'][key] = f'{rel}?v={h}'
        print('guide', key)
    manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding='utf-8')
    print(f'done: {len(affs)} affirmations, {len(guides)} guides -> {manifest_path}')


if __name__ == '__main__':
    if hasattr(sys.stdout, 'reconfigure'):
        sys.stdout.reconfigure(encoding='utf-8')
    p = argparse.ArgumentParser()
    p.add_argument('--list', action='store_true')
    p.add_argument('--samples', action='store_true')
    p.add_argument('--speaker', type=int)
    p.add_argument('--voice-name', default='')
    p.add_argument('--engine', choices=ENGINES, default='aivis')
    p.add_argument('--speed', type=float)
    p.add_argument('--pitch', type=float)
    p.add_argument('--intonation', type=float)
    a = p.parse_args()
    API, engine_name = ENGINES[a.engine]
    if a.list:
        list_voices()
    elif a.samples:
        make_samples()
    elif a.speaker:
        generate(a.speaker, a.voice_name or str(a.speaker), engine_name, a.speed, a.pitch, a.intonation)
    else:
        p.print_help()

// 固定データ：テーマ・アファメーション文例・ガイド音声の台本・星座名
// tools/generate_audio.py もこのファイルを読み込んで音声を作る（JSON部分の書式を崩さないこと）

const THEMES = {
  self:     { name: '自己肯定感・自信',     icon: '✦' },
  work:     { name: '仕事・お金・キャリア', icon: '◆' },
  health:   { name: '健康・心の安らぎ',     icon: '❀' },
  relation: { name: '人間関係・愛情',       icon: '♡' },
};

const AFFIRMATION_TEMPLATES = [
  { id: 's1', theme: 'self', text: '私は、今の自分を大切にしています。' },
  { id: 's2', theme: 'self', text: '私には、自分で選び、進んでいく力があります。' },
  { id: 's3', theme: 'self', text: '私は、昨日より少しずつ成長しています。' },
  { id: 's4', theme: 'self', text: '私は、自分の気持ちを素直に受けとめています。' },
  { id: 's5', theme: 'self', text: '私は、失敗も学びに変えることができます。' },
  { id: 's6', theme: 'self', text: '私は、私のままで価値のある存在です。' },

  { id: 'w1', theme: 'work', text: '私は、自分の力を仕事で活かしています。' },
  { id: 'w2', theme: 'work', text: '私は、目の前のことに集中し、一歩ずつ進んでいます。' },
  { id: 'w3', theme: 'work', text: '私は、豊かさを受け取る準備ができています。' },
  { id: 'w4', theme: 'work', text: '私は、新しいチャンスに心を開いています。' },
  { id: 'w5', theme: 'work', text: '私の仕事は、誰かの役に立っています。' },
  { id: 'w6', theme: 'work', text: '私は、お金を大切に、気持ちよく使っています。' },

  { id: 'h1', theme: 'health', text: '私は、体をいたわる習慣を選んでいます。' },
  { id: 'h2', theme: 'health', text: '深く呼吸するたびに、心が落ち着いていきます。' },
  { id: 'h3', theme: 'health', text: '私は、休むことを自分に許しています。' },
  { id: 'h4', theme: 'health', text: '私は、今この瞬間に安心しています。' },
  { id: 'h5', theme: 'health', text: '私は、心と体の声に耳を傾けています。' },
  { id: 'h6', theme: 'health', text: '今日も、自分のペースで過ごしています。' },

  { id: 'r1', theme: 'relation', text: '私は、まわりの人と温かい関係を築いています。' },
  { id: 'r2', theme: 'relation', text: '私は、感謝の気持ちを言葉にしています。' },
  { id: 'r3', theme: 'relation', text: '私は、愛を受け取り、愛を与えています。' },
  { id: 'r4', theme: 'relation', text: '私は、相手の違いを尊重しています。' },
  { id: 'r5', theme: 'relation', text: '私は、出会う人とのご縁を大切にしています。' },
  { id: 'r6', theme: 'relation', text: '私は、自分にも人にもやさしくいられます。' },
];

// ガイド音声の台本（キー = 音声ファイル名）
const GUIDE_SCRIPTS = {
  morning_intro:  'おはようございます。今日も、ここに来てくれてありがとう。まずは、ゆっくり呼吸を整えましょう。',
  breath_in:      '吸って',
  breath_hold:    '止めて',
  breath_out:     'ゆっくり、吐いて',
  visualize:      '目を閉じて、北極星に掲げた目標が叶った場面を思い描いてみましょう。どこにいて、誰といて、どんな気持ちでしょうか。',
  affirm_intro:   'では、あなたの言葉を、心の中で、あるいは声に出して、唱えましょう。',
  morning_outro:  '素敵な一日になりますように。今日の星がひとつ、夜空に灯りました。',
  night_intro:    'こんばんは。今日も一日、おつかれさまでした。楽な姿勢になって、目を閉じましょう。呼吸に意識を向けていきます。考えが浮かんできても大丈夫。そっと、呼吸に戻りましょう。',
  meditation_end: 'ゆっくりと、意識を戻していきましょう。指先を少し動かして、目を開けてください。',
  reflect_intro:  '今日一日をふり返って、心に残ったことを、ひとこと書いてみましょう。',
  night_outro:    '今日のあなたに、ひとつ星が灯りました。おやすみなさい。',
};

const CONSTELLATION_NAMES = [
  'はじまりの星座', '勇気の星座', '希望の星座', 'やすらぎの星座',
  'めぐりの星座', 'ひかりの星座', 'つばさの星座', 'いずみの星座',
  'みちしるべの星座', 'ゆめの星座', 'きずなの星座', 'かがやきの星座',
];

const STARS_PER_CONSTELLATION = 7;

const MOODS = [
  { v: 1, icon: '☁', label: 'しんどい' },
  { v: 2, icon: '☂', label: 'いまいち' },
  { v: 3, icon: '☾', label: 'ふつう' },
  { v: 4, icon: '☆', label: 'よい' },
  { v: 5, icon: '✦', label: 'とてもよい' },
];

const DISCLAIMER = 'Life Compass Coach は、習慣づくりとセルフケアのためのアプリです。医療行為・診断・治療の代わりになるものではありません。心や体の不調が続くときは、医師や専門家にご相談ください。';

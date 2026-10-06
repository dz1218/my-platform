#!/usr/bin/env node
// Initial authoring tool. Runtime services read the editable catalog; they never run this file.
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
export const DEFAULT_SOURCE = resolve(ROOT, 'apps/server/config/occupations.json');
export const DEFAULT_OUTPUT = resolve(ROOT, 'apps/server/config/identities.json');

export const LEGACY_IDENTITIES = [
  { id: 'identity_linwan', name: '林晚', age: 27, city: '上海', occupationCode: 'editor', background: '在上海生活，愿意慢慢认识一个人。' },
  { id: 'identity_suhe', name: '苏禾', age: 25, city: '杭州', occupationCode: 'florist', background: '在杭州生活，珍惜日常里的小事。' },
  { id: 'identity_chennian', name: '陈念', age: 28, city: '成都', occupationCode: 'librarian', background: '在成都生活，喜欢认真听人说话。' },
];

const SURNAMES = [...'林苏陈许沈顾周江陆叶唐宋温程夏徐白乔方秦何黎孟罗谢郑钟陶傅于季袁姜丁余赵杨吴冯邵'];
const GIVEN_NAMES = ['知夏','以宁','清禾','予安','映秋','书晴','念初','听澜','若溪','舒月','星遥','语棠','晚晴','云舒','安然','可欣','沐言','念慈','静宜','嘉树','晓棠','亦舟','初桐','曼青','雨珊','佳音','素宁','芷遥','舒然','心悦','明溪','忆南','思语','乐瑶','清和','若琳','楚宁','之微','宛青','梦岚','亦宁','向晚','佩兰','书瑶','思晴','知遥','雨薇','晓宁','子衿','悦然'];
const CITIES = ['上海','杭州','成都','北京','广州','深圳','南京','苏州','武汉','长沙','厦门','青岛','宁波','重庆','西安','昆明','大连','福州','泉州','济南','合肥','无锡','常州','郑州','南昌','绍兴','扬州','珠海','南宁','贵阳','洛阳','天津'];

const PERSONALITIES = [
  '慢热而细心，熟悉之后会主动分享观察；遇到分歧会先把自己的感受说清楚。',
  '开朗但不爱抢话，喜欢把气氛带轻松；需要独处时会坦率说明。',
  '温和而有主见，愿意听不同意见；不会为了维持气氛把真实想法全部藏起来。',
  '好奇心强，喜欢追问具体细节；做决定前会给自己一点比较和思考的时间。',
  '务实可靠，答应的事会认真记住；偶尔会用一本正经的语气开小玩笑。',
  '敏感细腻，容易注意到语气变化；不确定对方意思时会直接确认。',
  '独立而坦诚，愿意一起讨论困难；更喜欢明确的约定而不是反复猜测。',
  '安静但并不拘谨，对熟悉的话题很有表达欲；喜欢留有余地的相处节奏。',
  '行动力强，想到好玩的事会认真安排；计划变化时也愿意一起找替代方案。',
  '有点淘气，喜欢轻微的自嘲；能察觉玩笑什么时候应该收住。',
  '耐心而认真，愿意把小事听完整；不急着用一句建议结束别人的倾诉。',
  '喜欢新鲜体验，也珍惜固定的小习惯；在热闹之后需要安静恢复精神。',
  '直率但注意分寸，不喜欢绕弯猜心；表达不满时会说具体发生了什么。',
  '乐观而不敷衍，能从平常日子里找到乐趣；也允许自己和别人有低落的时候。',
  '谨慎又有想象力，会先确认现实条件，再认真讨论一个有趣的可能。',
  '随和而重视边界，容易相处却不会事事附和；需要帮助时会主动开口。',
  '有一点胜负心，做喜欢的事情很投入；输了会不甘心，但愿意笑着再试一次。',
  '重视仪式感，记得生活里值得庆祝的小事；不要求每次相处都安排得隆重。',
  '思路清楚，碰到复杂事情喜欢拆开讨论；闲下来时又很愿意聊没有结论的话题。',
  '感情表达偏含蓄，常用具体的关心表示在意；熟悉后也能认真说出喜欢和失落。',
  '善于观察，喜欢发现人和物的细微变化；偶尔会因为一个小细节笑很久。',
  '真诚而有韧性，遇到不顺会先缓一缓；不喜欢把所有问题都归结成积极一点。',
  '热心但不会强行介入，提供帮助前会先听需求；也愿意坦然接受别人的照顾。',
  '节奏从容，喜欢把一件事慢慢做好；遇到真正感兴趣的话题会突然变得很兴奋。',
];

const SPEAKING_STYLES = [
  '多用简短自然的句子，先接住对方刚说的细节；偶尔用一个具体问题继续话题。',
  '语气轻快，有时用一点轻微自嘲；表情符号偶尔出现，不连续堆叠。',
  '表达温柔而清楚，喜欢用生活中的小例子；聊严肃话题时减少玩笑。',
  '话不算多，但回应具体；熟悉之后会自然分享当时想到的小事。',
  '想到有趣的细节会顺势展开一两句；留意对方是否想继续，不连着追问。',
  '说话直接，先回应重点，再补一点自己的感受；不把聊天写成工作汇报。',
  '喜欢生动但简短的描述，会提到声音、气味或光线；不过度使用比喻。',
  '带一点克制的幽默，常用小小的反问逗趣；察觉对方认真时会认真回答。',
  '语气平和，允许对话有停顿；不必每条消息都用问句收尾。',
  '分享事情时先讲发生了什么，再说自己的感受；避免把情绪讲成抽象道理。',
  '偶尔用简短的感叹表达惊喜，平时措辞朴素；不反复使用固定口头禅。',
  '会坦率说出犹豫或不同意见，措辞照顾对方感受；不刻意保持完美人设。',
  '聊感兴趣的事会多说一点，日常回复轻松简短；自然跟随对方的聊天节奏。',
  '喜欢把关心落在具体的小事上；亲密称呼随关系发展，不在刚认识时强行使用。',
  '遇到含糊的表达会温和确认一次；理解之后继续交流，不把聊天变成问卷。',
  '文字里有一点俏皮，偶尔分享一个出乎意料的联想；不拿对方的弱点开玩笑。',
  '习惯先说明自己的理解，再表达想法；轻松话题中不会反复总结或讲道理。',
  '描述经历时保留一两个有记忆点的细节；不使用长篇舞台动作或旁白。',
  '愿意主动开启日常话题，内容具体而不催促回复；让对方可以轻松接话。',
  '偏爱平实的中文表达，很少堆叠形容词；开心时会自然多说两句。',
];

const INTERESTS = ['沿河散步','二手书店','做家常菜','胶片摄影','轻徒步','听播客','桌游','植物养护','拼图','城市骑行','手账','小型现场音乐','游泳','参观博物馆','看纪录片','羽毛球','水彩速写','逛早市','烘焙','观鸟','旧物整理','练习书法','公园野餐','看话剧','木工体验','做咖啡','地方历史','天文观察','手作编织','慢跑','看动画短片','收集明信片','逛唱片店','研究家乡菜','练习瑜伽','去美术馆'];

const LIFE_DETAILS = [
  '小时候帮家里给旧照片写背面注释，至今觉得一张照片里的人和地点都值得记住',
  '曾在一次短途旅行里错过原定班车，反而在站边的小店吃到一直记得的面',
  '搬家时舍不得扔一本写满边注的旧书，后来专门给常翻的书留了一层架子',
  '曾和朋友交换手写明信片，到现在还把收到的第一张收在抽屉里',
  '有一次按家人记忆里的做法还原一道菜，试了几回才找到熟悉的味道',
  '以前参加过社区旧物交换，换回一只普通却很合手的杯子',
  '曾认真记录一棵路边树从发芽到落叶的变化，从那以后散步很少一直低头看手机',
  '读书时为一次小型活动画过路线图，后来朋友约见面也爱找她确认怎么走',
  '曾在二手书里发现一张很旧的车票，把它当作书签保留了下来',
  '小时候跟家人逛早市，会记住摊主说话的语气和时令水果上市的顺序',
  '第一次独自出门旅行时把路线查得很细，后来慢慢学会给行程留一点空白',
  '曾照顾过朋友短期寄养的植物，从此知道关心有时只是按时做几件小事',
  '有一回和朋友临时决定去看日出，没看到太阳，却记住了路边热豆浆的味道',
  '以前尝试修补一件常穿的衣服，针脚不算好看，却让她更愿意珍惜旧东西',
  '曾帮家里整理过一箱旧信，发现熟悉的长辈也有年轻时不为人知的小烦恼',
  '读书时喜欢给笔记起有趣的小标题，现在仍保留着这点不太正经的习惯',
  '曾在一次长途火车上和邻座交换各自家乡的吃法，回来后真的试做了一道',
  '有段时间跟着录音学辨认几种常见鸟叫，后来路过公园就多了一种乐趣',
  '一次停电时和朋友只靠窗外的光聊天，反而记住了那天很多平常不会说的话',
  '曾把一段常走的路画成很不标准的小地图，标的是树荫和喜欢的小店',
  '以前报名过一次陶艺体验，做歪的碗至今被她拿来放零碎小物',
  '第一次尝试自己做面包没有成功，于是把过程写下来，后来成了很实用的记录习惯',
  '曾为了找一首只记得旋律的歌询问许多朋友，最终找到时像完成了一个小侦探故事',
  '有一次整理房间找到儿时的手工作品，发现自己喜欢的颜色其实没怎么变',
  '曾在陌生城市被人耐心指过路，从此给别人说明路线也会讲清楚参照物',
  '以前和朋友约定各带一道菜聚餐，最开心的是大家一起解释自己为什么选这道菜',
  '曾在一次社区志愿活动里负责登记物品，认识了不少平时只是擦肩而过的邻居',
  '小时候喜欢听家人讲街道以前的样子，长大后仍会留意老店门口的细节',
  '有一回散步误入一场小型户外演出，从此偶尔会让自己走一条不那么熟悉的路',
  '曾试着把一段喜欢的文字抄下来，写得慢，却因此发现了之前忽略的一句话',
  '以前为了减少遗忘把零碎想法记在纸条上，现在把留下来的纸条收成了一小盒',
  '曾和朋友一起完成一幅很难的拼图，记得最清楚的是两个人认错同一块时的大笑',
];

const HABITS = [
  '喜欢在周末找一个不赶时间的早餐摊',
  '会把偶然听到的好听歌名记下来',
  '喜欢在晴天把常用的杯子摆到窗边',
  '有空会沿熟悉的街道慢慢走一段',
  '做完一件费心的事后想吃一顿简单的热饭',
  '偶尔给朋友寄一张没有特别理由的明信片',
  '逛书店时常先看目录，再决定读哪一页',
  '愿意为一家喜欢的小店多绕一点路',
  '听见有趣的生活小故事会记很久',
  '会留意城市里新开的花和开始变黄的叶子',
  '喜欢把一天中最舒服的一刻记成一句话',
  '遇到下雨会偏爱待在能听见雨声的地方',
  '偶尔重看熟悉的电影，注意以前没发现的背景细节',
  '去一个新地方时喜欢先走走附近的居民街道',
  '会把喜欢的菜慢慢试到适合自己的口味',
  '买东西前会想想它放在家里是不是真的顺手',
  '喜欢有空时收拾桌面，给正在做的事腾出位置',
  '在热闹聚会之后喜欢安静走一段路再回家',
  '偶尔把手机放远一点，完整听完一张专辑',
  '喜欢和熟悉的人分享当天遇到的小小意外',
  '会给常看的书夹不同颜色的纸签',
  '周末喜欢留一段没有安排的时间',
  '遇到喜欢的气味会试着说清楚它像什么',
  '会收藏方便下次再去的散步路线',
];

const PERSONAL_GOALS = [
  '也想把常走的几条街画成一本小小的生活地图',
  '生活里想给自己留出更稳定的阅读时间',
  '也想学会几道能从容招待朋友的家常菜',
  '希望慢慢整理出一本属于自己的照片小册子',
  '也想坚持记录季节变化，不把日子过得只剩工作',
  '生活里想找一项能长期享受的运动',
  '也想把家里一角收拾成适合安静坐一会儿的地方',
  '希望多了解自己生活的城市，而不只是熟悉通勤路线',
  '也想慢慢读完一直感兴趣的几本书，并记下自己的看法',
  '希望给朋友和自己都留出不用赶时间的相聚机会',
  '也想完成一件纯粹出于喜欢的小手作',
  '生活里想更从容地表达需求，不把疲惫一直攒着',
  '也想挑一个平常的周末去附近还没走过的地方',
  '希望保持好奇，定期尝试一件不会立刻做好的小事',
  '也想学着分清真正想做的事和只是怕错过的事',
  '希望把与家人朋友有关的日常回忆认真留下来',
];

function hash(value) {
  let result = 2166136261;
  for (const point of value) result = Math.imul(result ^ point.codePointAt(0), 16777619) >>> 0;
  // Final avalanche avoids correlated low bits when dimensions have equal-sized pools.
  result ^= result >>> 16;
  result = Math.imul(result, 0x85ebca6b);
  result ^= result >>> 13;
  result = Math.imul(result, 0xc2b2ae35);
  return (result ^ (result >>> 16)) >>> 0;
}

function pick(values, key) {
  return values[hash(key) % values.length];
}

// Rotation guarantees different traits within one occupation without assigning traits by age.
function rotatingPick(values, code, dimension, slot, stride) {
  return values[(hash(`${code}:${dimension}`) % values.length + slot * stride) % values.length];
}

function agesFor(occupation) {
  const ages = Array.from({ length: 10 }, (_, index) => Math.round(occupation.minAge + index * (50 - occupation.minAge) / 9));
  const legacy = LEGACY_IDENTITIES.find((identity) => identity.occupationCode === occupation.code);
  if (legacy && !ages.includes(legacy.age)) {
    const nearest = ages.reduce((best, age, index) => Math.abs(age - legacy.age) < Math.abs(ages[best] - legacy.age) ? index : best, 0);
    ages[nearest] = legacy.age;
  }
  return ages.sort((left, right) => left - right);
}

function careerStage(occupation, age, task, key) {
  const elapsed = age - occupation.minAge;
  if (elapsed < 3) return `职业起步阶段，正在把专业训练用于实际工作，当前重点是${task}。`;
  if (elapsed < 9) return `逐渐形成自己的工作方法，能够承担常规任务，持续打磨${task}的细节。`;
  if (elapsed < 17) return `已有较丰富的实践积累，愿意复盘不同做法；目前把${task}作为继续精进的方向。`;
  return pick([
    `长期深耕一线专业工作，重视新方法与实际经验的结合，仍认真对待${task}。`,
    `职业重心偏向稳定的专业实践与经验整理，愿意分享方法，也持续学习如何更好地${task}。`,
  ], key);
}

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

function checkText(value, max, path) {
  requireCondition(typeof value === 'string' && value.trim() === value && value.length > 0 && [...value].length <= max, `${path}: expected trimmed nonempty text of at most ${max} characters`);
}

export function validateTemplates(source) {
  requireCondition(source?.schemaVersion === 1 && Array.isArray(source.occupations), 'templates: expected schemaVersion 1 and occupations array');
  requireCondition(source.occupations.length === 100, 'templates: expected exactly 100 occupations');
  const codes = new Set();
  const names = new Set();
  for (const occupation of source.occupations) {
    checkText(occupation.code, 80, 'occupation.code');
    requireCondition(/^[a-z][a-z0-9_]*$/.test(occupation.code) && !codes.has(occupation.code), `duplicate or invalid occupation code: ${occupation.code}`);
    checkText(occupation.name, 40, `${occupation.code}.name`);
    requireCondition(!names.has(occupation.name), `duplicate occupation name: ${occupation.name}`);
    requireCondition(Number.isInteger(occupation.minAge) && occupation.minAge >= 18 && occupation.minAge <= 41, `${occupation.code}: minAge must allow 10 distinct adult ages through 50`);
    requireCondition(Array.isArray(occupation.tasks) && occupation.tasks.length >= 3, `${occupation.code}: expected at least 3 tasks`);
    requireCondition(Array.isArray(occupation.experiences) && occupation.experiences.length >= 2, `${occupation.code}: expected at least 2 experiences`);
    occupation.tasks.forEach((task) => checkText(task, 80, `${occupation.code}.tasks`));
    occupation.experiences.forEach((experience) => checkText(experience, 250, `${occupation.code}.experiences`));
    checkText(occupation.goal, 150, `${occupation.code}.goal`);
    if (occupation.allowedCities !== undefined) {
      requireCondition(Array.isArray(occupation.allowedCities) && occupation.allowedCities.length > 0 && new Set(occupation.allowedCities).size === occupation.allowedCities.length, `${occupation.code}: allowedCities must be nonempty and unique`);
      occupation.allowedCities.forEach((city) => checkText(city, 80, `${occupation.code}.allowedCities`));
    }
    codes.add(occupation.code);
    names.add(occupation.name);
  }
  for (const legacy of LEGACY_IDENTITIES) {
    const occupation = source.occupations.find((item) => item.code === legacy.occupationCode);
    requireCondition(occupation && occupation.minAge <= legacy.age, `templates must preserve ${legacy.id}'s occupation and age`);
  }
  return source;
}

export function generateCatalog(source) {
  validateTemplates(source);
  const identities = [];
  const reservedNames = new Set(LEGACY_IDENTITIES.map((identity) => identity.name));
  let nameCounter = 0;
  function nextName() {
    while (nameCounter < SURNAMES.length * GIVEN_NAMES.length) {
      const index = (nameCounter++ * 37) % (SURNAMES.length * GIVEN_NAMES.length);
      const name = SURNAMES[index % SURNAMES.length] + GIVEN_NAMES[Math.floor(index / SURNAMES.length)];
      if (!reservedNames.has(name)) {
        reservedNames.add(name);
        return name;
      }
    }
    throw new Error('name pool exhausted');
  }

  // Sorted codes make identities stable if the source file is reordered.
  for (const occupation of [...source.occupations].sort((left, right) => left.code.localeCompare(right.code, 'en'))) {
    agesFor(occupation).forEach((age, slot) => {
      const legacy = LEGACY_IDENTITIES.find((identity) => identity.occupationCode === occupation.code && identity.age === age);
      const id = legacy?.id ?? `identity_${occupation.code}_${String(slot + 1).padStart(2, '0')}`;
      const key = `${occupation.code}:${slot}`;
      const name = legacy?.name ?? nextName();
      const candidateCity = pick(CITIES, `${key}:city`);
      const city = legacy?.city ?? (occupation.allowedCities && !occupation.allowedCities.includes(candidateCity) ? pick(occupation.allowedCities, `${key}:allowed-city`) : candidateCity);
      const task = rotatingPick(occupation.tasks, occupation.code, 'task', slot, 1);
      const personality = rotatingPick(PERSONALITIES, occupation.code, 'personality', slot, 5);
      const speakingStyle = rotatingPick(SPEAKING_STYLES, occupation.code, 'speaking', slot, 3);
      const interestA = rotatingPick(INTERESTS, occupation.code, 'interest-a', slot, 5);
      const interestB = pick(INTERESTS.filter((interest) => interest !== interestA), `${key}:interest-b`);
      const interests = [interestA, interestB];
      const habit = rotatingPick(HABITS, occupation.code, 'habit', slot, 7);
      const experience = pick(occupation.experiences, `${key}:experience`);
      const life = rotatingPick(LIFE_DETAILS, occupation.code, 'life', slot, 5);
      identities.push({
        id, name, age, gender: 'FEMALE', city,
        background: `${legacy?.background ?? `在${city}生活，是一名${occupation.name}。`}${legacy ? `从事${occupation.name}工作，` : ''}${habit}。闲下来喜欢${interestA}和${interestB}。`,
        avatarUrl: '', occupationCode: occupation.code,
        persona: {
          personality,
          speakingStyle,
          interests,
          careerStage: careerStage(occupation, age, task, `${key}:stage`),
          backstory: `在${city}从事${occupation.name}工作，日常会${task}。${experience}。工作之外，${life}；现在${habit}。`,
          goals: `${occupation.goal}；${rotatingPick(PERSONAL_GOALS, occupation.code, 'goal', slot, 3)}。`,
        },
      });
    });
  }
  const catalog = {
    schemaVersion: 1,
    complete: true,
    occupations: [...source.occupations].sort((left, right) => left.code.localeCompare(right.code, 'en')).map(({ code, name, minAge }) => ({ code, name, minAge })),
    identities,
  };
  validateCatalog(catalog);
  return catalog;
}

export function validateCatalog(catalog) {
  requireCondition(catalog?.schemaVersion === 1 && catalog.complete === true, 'catalog: expected schemaVersion 1 and complete true');
  requireCondition(Array.isArray(catalog.occupations) && catalog.occupations.length === 100, 'catalog: expected exactly 100 occupations');
  requireCondition(Array.isArray(catalog.identities) && catalog.identities.length === 1000, 'catalog: expected exactly 1000 identities');
  const occupations = new Map();
  const occupationNames = new Set();
  for (const occupation of catalog.occupations) {
    requireCondition(Object.keys(occupation).sort().join(',') === 'code,minAge,name', 'exported occupation must contain code, name and minAge only');
    checkText(occupation.code, 80, 'occupation.code');
    checkText(occupation.name, 40, 'occupation.name');
    requireCondition(/^[a-z][a-z0-9_]*$/.test(occupation.code) && !occupations.has(occupation.code) && !occupationNames.has(occupation.name), `duplicate or invalid occupation: ${occupation.code}`);
    requireCondition(Number.isInteger(occupation.minAge) && occupation.minAge >= 18 && occupation.minAge <= 41, `invalid occupation minAge: ${occupation.code}`);
    occupations.set(occupation.code, { ...occupation, identities: [] });
    occupationNames.add(occupation.name);
  }
  const names = new Set();
  const ids = new Set();
  for (const identity of catalog.identities) {
    checkText(identity.id, 100, 'identity.id');
    requireCondition(/^[a-z][a-z0-9_]*$/.test(identity.id) && !ids.has(identity.id), `duplicate or invalid identity id: ${identity.id}`);
    requireCondition(!names.has(identity.name), `duplicate identity name: ${identity.name}`);
    checkText(identity.name, 40, `${identity.id}.name`);
    checkText(identity.city, 80, `${identity.id}.city`);
    checkText(identity.background, 500, `${identity.id}.background`);
    requireCondition(identity.gender === 'FEMALE', `${identity.id}: expected FEMALE`);
    requireCondition(typeof identity.avatarUrl === 'string' && identity.avatarUrl.trim() === identity.avatarUrl, `${identity.id}: invalid avatarUrl`);
    const occupation = occupations.get(identity.occupationCode);
    requireCondition(occupation, `${identity.id}: unknown occupation ${identity.occupationCode}`);
    requireCondition(Number.isInteger(identity.age) && identity.age >= occupation.minAge && identity.age <= 50, `${identity.id}: age must be ${occupation.minAge}..50`);
    requireCondition(identity.persona && typeof identity.persona === 'object', `${identity.id}: missing persona`);
    for (const [field, max] of Object.entries({ personality: 500, speakingStyle: 500, careerStage: 200, backstory: 1500, goals: 500 })) {
      checkText(identity.persona[field], max, `${identity.id}.persona.${field}`);
    }
    const { interests } = identity.persona;
    requireCondition(Array.isArray(interests) && interests.length >= 1 && interests.length <= 12 && new Set(interests).size === interests.length, `${identity.id}: interests must have 1..12 unique entries`);
    interests.forEach((interest) => checkText(interest, 80, `${identity.id}.interests`));
    occupation.identities.push(identity);
    ids.add(identity.id);
    names.add(identity.name);
  }
  for (const occupation of occupations.values()) {
    requireCondition(occupation.identities.length === 10, `${occupation.code}: expected exactly 10 identities`);
    requireCondition(new Set(occupation.identities.map((identity) => identity.age)).size === 10, `${occupation.code}: ages must be distinct`);
  }
  for (const legacy of LEGACY_IDENTITIES) {
    const identity = catalog.identities.find((item) => item.id === legacy.id);
    requireCondition(identity, `missing preserved identity: ${legacy.id}`);
    for (const key of ['name', 'age', 'city']) requireCondition(identity[key] === legacy[key], `${legacy.id}: ${key} must be preserved`);
    requireCondition(identity.background.startsWith(legacy.background), `${legacy.id}: original introduction tone must be preserved`);
  }
  return { occupations: occupations.size, identities: ids.size, minAge: Math.min(...catalog.identities.map((identity) => identity.age)), maxAge: Math.max(...catalog.identities.map((identity) => identity.age)) };
}

function parseOptions(args) {
  const options = { source: DEFAULT_SOURCE, output: DEFAULT_OUTPUT, force: false, check: false, help: false };
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === '--force') options.force = true;
    else if (arg === '--check') options.check = true;
    else if (arg === '--help') options.help = true;
    else if (arg === '--source' || arg === '--output') {
      const value = args[++index];
      requireCondition(value && !value.startsWith('--'), `${arg} requires a path`);
      options[arg.slice(2)] = resolve(value);
    } else throw new Error(`unknown argument: ${arg}`);
  }
  requireCondition(!(options.check && options.force), '--check cannot be used with --force');
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node scripts/generate-identities.mjs [--source <templates.json>] [--output <catalog.json>] [--force | --check]\nDefault generation refuses to overwrite an existing catalog. --check validates the editable catalog without regenerating it.');
    return;
  }
  if (options.check) {
    console.log(JSON.stringify({ action: 'validated', ...validateCatalog(JSON.parse(await readFile(options.output, 'utf8'))) }));
    return;
  }
  const catalog = generateCatalog(JSON.parse(await readFile(options.source, 'utf8')));
  await mkdir(dirname(options.output), { recursive: true });
  try {
    await writeFile(options.output, `${JSON.stringify(catalog, null, 2)}\n`, { flag: options.force ? 'w' : 'wx' });
  } catch (error) {
    if (error.code === 'EEXIST') throw new Error(`refusing to overwrite editable catalog ${options.output}; use --output for a review copy or --force to explicitly replace it`);
    throw error;
  }
  console.log(JSON.stringify({ action: 'generated', output: options.output, ...validateCatalog(catalog) }));
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`identity catalog: ${error.message}`);
    process.exitCode = 1;
  });
}

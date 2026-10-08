// 게임 데이터 묶음. core 함수에는 이 객체를 인자로 넘긴다 (core는 데이터 import에 의존하지 않음).
import balance from './balance.json';
import days from './days.json';
import rules from './rules.json';
import names from './names.json';
import districts from './districts.json';
import appearance from './appearance.json';
import events from './events.json';

export const gameData = Object.freeze({ balance, days, rules, names, districts, appearance, events });

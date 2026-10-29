'use strict';
// Generate the explicit bounded Rules expression. The generated JSON is the tested artifact.
const fs = require('node:fs');
const path = require('node:path');
const v1 = require('../event-round/rules.json').rules.events.$event;
const event = "root.child('events').child($event)";
const pub = `${event}.child('public')`;
const old = `${pub}.child('state')`;
const setup = `${event}.child('private').child('rounds')`;
const version = `${pub}.child('formatVersion').val() == 2`;
const host = `${version} && auth != null && auth.uid == ${event}.child('hostUid').val() && auth.token.firebase.sign_in_provider == 'password'`;
const validId = "$round.matches(/^r(0[1-9]|1[0-9]|20)$/)";
const oldId = `${old}.child('roundId').val()`;
const oldSetup = `${setup}.child(${oldId})`;
const nextState = "newData.parent().child('state')";
const phase = `${old}.child('phase').val()`;
const sameRound = "newData.child('roundId').val() == data.child('roundId').val()";
const keepLast = "newData.child('lastRevealedRoundId').val() == data.child('lastRevealedRoundId').val()";
const newPublic = 'newData.parent()';
const transitions = [
 `((data.child('phase').val() == 'lobby' || data.child('phase').val() == 'ready') && newData.child('phase').val() == 'guessing' && ${sameRound} && ${keepLast} && ${pub}.child('participants').hasChildren() && !${pub}.child('rounds').child(data.child('roundId').val()).child('clue').exists() && ${newPublic}.child('rounds').child(data.child('roundId').val()).child('clue').exists())`,
 `(data.child('phase').val() == 'guessing' && newData.child('phase').val() == 'closed' && ${sameRound} && ${keepLast})`,
 `(data.child('phase').val() == 'closed' && newData.child('phase').val() == 'reveal' && ${sameRound} && newData.child('lastRevealedRoundId').val() == data.child('roundId').val() && !${pub}.child('rounds').child(data.child('roundId').val()).child('reveal').exists() && ${newPublic}.child('rounds').child(data.child('roundId').val()).child('reveal').exists())`,
 `(data.child('phase').val() == 'reveal' && newData.child('phase').val() == 'ready' && ${keepLast} && ${oldSetup}.child('nextRoundId').exists() && newData.child('roundId').val() == ${oldSetup}.child('nextRoundId').val() && ${setup}.child(newData.child('roundId').val()).child('previousRoundId').val() == data.child('roundId').val())`,
 `(data.child('phase').val() == 'reveal' && newData.child('phase').val() == 'complete' && ${sameRound} && ${keepLast} && !${oldSetup}.child('nextRoundId').exists())`,
];
const state = {
 '.read': version,
 '.write': `${host} && data.exists() && newData.exists() && newData.child('revision').val() == data.child('revision').val() + 1 && (${transitions.join(' || ')})`,
 '.validate': "newData.hasChildren(['phase','roundId','revision'])",
 phase: {'.validate': "newData.isString() && newData.val().matches(/^(lobby|ready|guessing|closed|reveal|complete)$/)"},
 roundId: {'.validate': "newData.isString() && newData.val().matches(/^r(0[1-9]|1[0-9]|20)$/)"},
 revision: {'.validate': 'newData.isNumber() && newData.val() % 1 == 0 && newData.val() >= 0 && newData.val() <= 80'},
 lastRevealedRoundId: {'.validate': "newData.isString() && newData.val().matches(/^r(0[1-9]|1[0-9]|20)$/)"},
 '$other': {'.validate': false},
};
// Enforce the exact bounded phase/revision/last-reveal shape, including final count.
const semantic = [];
for (let n = 1; n <= 20; n++) {
 const id = `r${String(n).padStart(2,'0')}`, prev = `r${String(n-1).padStart(2,'0')}`;
 for (const [p, rev] of [['ready',4*n-4],['guessing',4*n-3],['closed',4*n-2],['reveal',4*n-1],['complete',4*n]]) {
  if (p === 'ready' && n === 1) continue;
  const last = p === 'reveal' || p === 'complete' ? `newData.child('lastRevealedRoundId').val() == '${id}'` : n === 1 ? "!newData.hasChild('lastRevealedRoundId')" : `newData.child('lastRevealedRoundId').val() == '${prev}'`;
  semantic.push(`(newData.child('roundId').val() == '${id}' && newData.child('phase').val() == '${p}' && newData.child('revision').val() == ${rev} && ${last} && ${pub}.child('roundCount').val() ${p === 'complete' ? '==' : '>='} ${n})`);
 }
}
state['.validate'] += ` && (${semantic.join(' || ')})`;
const participants = JSON.parse(JSON.stringify(v1.public.participants));
participants['.read'] = version;
participants.$uid['.write'] = `${version} && ` + participants.$uid['.write'].replace(`${pub}.child('phase').val() == 'lobby'`, `${phase} == 'lobby' && ${oldId} == 'r01' && ${old}.child('revision').val() == 0`);
const slots = JSON.parse(JSON.stringify(v1.public.slots));
slots['.read'] = version;
slots.$slot['.write'] = `${version} && ` + slots.$slot['.write'].replace(`${pub}.child('phase').val() == 'lobby'`, `${phase} == 'lobby' && ${oldId} == 'r01' && ${old}.child('revision').val() == 0`);
const roundPublic = 'newData.parent().parent().parent()';
const changeState = `${roundPublic}.child('state')`;
const atomic = `${changeState}.child('roundId').val() == $round && ${changeState}.child('revision').val() == ${old}.child('revision').val() + 1`;
const clue = {'.read':version,'.write': `${host} && ${validId} && !data.exists() && newData.exists() && ${oldId} == $round && (${phase} == 'lobby' || ${phase} == 'ready') && ${changeState}.child('phase').val() == 'guessing' && ${atomic}`, '.validate': "newData.hasChildren(['id','panoramaId','heading','pitch'])", '$other': {'.validate':false}};
for (const key of ['id','panoramaId','heading','pitch']) clue[key] = {'.validate': `newData.val() == ${setup}.child($round).child('${key}').val()`};
const result = JSON.parse(JSON.stringify(v1.public.reveal.results.$uid));
result['.validate'] = result['.validate'].replaceAll(".child('r1')", '.child($round)').replace("['nickname','answered','points']", "['nickname','answered','points','totalPoints']");
const prior = `${pub}.child('rounds').child(${setup}.child($round).child('previousRoundId').val()).child('reveal').child('results').child($uid).child('totalPoints')`;
result.totalPoints = {'.validate': `newData.isNumber() && newData.val() % 1 == 0 && newData.val() >= 0 && newData.val() <= 100000 && (($round == 'r01' && newData.val() == newData.parent().child('points').val()) || ($round != 'r01' && ${prior}.exists() && newData.val() == ${prior}.val() + newData.parent().child('points').val()))`};
const reveal = {'.read': version, '.write': `${host} && ${validId} && !data.exists() && newData.exists() && ${oldId} == $round && ${phase} == 'closed' && ${changeState}.child('phase').val() == 'reveal' && ${changeState}.child('lastRevealedRoundId').val() == $round && ${atomic}`, '.validate': "newData.hasChildren(['roundId','answer','results'])", roundId:{'.validate':'newData.val() == $round'},answer:JSON.parse(JSON.stringify(v1.public.reveal.answer)),results:{'.validate':v1.public.reveal.results['.validate'],'$uid':result},'$other':{'.validate':false}};
for (const key of ['lat','lng']) reveal.answer[key]['.validate'] = reveal.answer[key]['.validate'].replace(".child('round')", ".child('rounds').child($round)");
const timing = {'.read':version, '.write':`${host} && ${validId} && ${oldId} == $round && ${phase} == 'guessing' && ${changeState}.child('phase').val() == 'guessing' && ${changeState}.val() == ${old}.val() && newData.exists() && (!data.exists() || newData.child('deadlineMs').val() > data.child('deadlineMs').val())`,'.validate':"newData.hasChildren(['roundId','deadlineMs'])",roundId:{'.validate':'newData.val() == $round'},deadlineMs:JSON.parse(JSON.stringify(v1.public.timing.deadlineMs)),'$other':{'.validate':false}};
// Snapshot equality is not supported: compare the immutable expected round/revision explicitly.
timing['.write'] = timing['.write'].replace(`${changeState}.val() == ${old}.val()`,`${changeState}.child('roundId').val() == $round && ${changeState}.child('revision').val() == ${old}.child('revision').val()`);
const guesses = JSON.parse(JSON.stringify(v1.private.guesses.r1));
guesses['.read'] = host;
guesses.$uid['.read'] = `${version} && ` + guesses.$uid['.read'];
guesses.$uid['.write'] = `${version} && ${validId} && ${oldId} == $round && ` + guesses.$uid['.write'].replace(`${pub}.child('phase').val()`,`${phase}`).replaceAll(`${pub}.child('timing')`,`${pub}.child('rounds').child($round).child('timing')`);
const rules = {rules:{'.read':false,'.write':false,events:{$event:{public:{title:{'.read':version},formatVersion:{'.read':true},roundCount:{'.read':version},state,participants,slots,rounds:{$round:{clue,reveal,timing}}},private:{rounds:{$round:{'.read':`${host} && ${validId}`}},guesses:{$round:guesses}}}}}};
fs.writeFileSync(path.join(__dirname,'rules.json'),JSON.stringify(rules,null,2)+'\n');

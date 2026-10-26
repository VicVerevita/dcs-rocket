const test = require('node:test');
const assert = require('node:assert/strict');
const { MessageFlags } = require('discord.js');
const { reportInteractionError } = require('../src/interactions/errors');

function fixture() {
  const replies = [];
  const logs = [];
  return {
    replies, logs,
    logger: {
      warn: (...args) => { logs.push(args); },
      error: (...args) => { logs.push(args); },
    },
    interaction: {
      id: 'interaction', guildId: '123', commandName: 'config',
      createdTimestamp: Date.now() - 4000,
      replied: false, deferred: false,
      isRepliable: () => true,
      reply: async (reply) => { replies.push({ method: 'reply', ...reply }); },
      followUp: async (reply) => { replies.push({ method: 'followUp', ...reply }); },
    },
  };
}

test('expired and answered interactions log timings without retrying or exposing callback tokens', async () => {
  for (const code of [10062, 40060]) {
    const { interaction, logger, replies, logs } = fixture();
    const receivedAt = Date.now() - 1000;
    const error = Object.assign(new Error('Interaction response rejected'), {
      code,
      url: 'https://discord.com/api/v10/interactions/id/secret-token/callback',
      requestBody: { json: { content: 'private content' } },
    });
    await reportInteractionError(interaction, error, receivedAt, logger);
    assert.equal(replies.length, 0);
    assert.equal(logs.length, 1);
    const context = logs[0][1];
    assert.equal(context.code, code);
    assert.equal(context.guildId, '123');
    assert.equal(context.command, 'config');
    assert.equal(context.ageAtReceiveMs, receivedAt - interaction.createdTimestamp);
    assert.ok(context.processingMs >= 1000);
    assert.doesNotMatch(JSON.stringify(logs), /secret-token|private content|requestBody/);
  }
});

test('unexpected handler failures send a private error through the appropriate response method', async () => {
  for (const state of ['initial', 'replied', 'deferred']) {
    const { interaction, logger, replies } = fixture();
    if (state !== 'initial') interaction[state] = true;
    await reportInteractionError(interaction, new Error('Handler failed'), Date.now(), logger);
    assert.equal(replies.length, 1);
    assert.equal(replies[0].method, state === 'initial' ? 'reply' : 'followUp');
    assert.equal(replies[0].flags, MessageFlags.Ephemeral);
  }
});

test('a failed error response is logged once without triggering another reply', async () => {
  const { interaction, logger, replies, logs } = fixture();
  interaction.reply = async () => {
    replies.push('attempted');
    throw Object.assign(new Error('Unknown interaction'), {
      code: 10062, url: 'https://discord.com/interactions/secret-token',
    });
  };
  await reportInteractionError(interaction, new Error('Handler failed'), Date.now(), logger);
  assert.equal(replies.length, 1);
  assert.equal(logs.length, 2);
  assert.equal(logs[1][1].code, 10062);
  assert.doesNotMatch(JSON.stringify(logs), /secret-token/);
});

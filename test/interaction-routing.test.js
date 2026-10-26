const test = require('node:test');
const assert = require('node:assert/strict');
const { createInteractionRouter } = require('../src/interactions/routing');

function fixture(type, guildId, customId) {
  const replies = [];
  return {
    replies,
    interaction: {
      guildId, customId, commandName: type === 'command' ? 'config' : undefined,
      isChatInputCommand: () => type === 'command',
      isButton: () => type === 'button',
      isModalSubmit: () => type === 'modal',
      reply: async (reply) => {
        assert.equal(replies.length, 0, 'Only the owning instance may acknowledge this interaction');
        replies.push(reply);
      },
    },
  };
}

function instance(guildId) {
  const calls = [];
  const handle = (name) => async (interaction) => {
    calls.push(name);
    await interaction.reply({ handledBy: guildId, handler: name });
  };
  return {
    calls,
    route: createInteractionRouter({
      guildIds: [guildId],
      commands: new Map([['config', { execute: handle('command') }]]),
      handleAddEventModal: handle('add'),
      handleEditEventModal: handle('edit'),
      handleReminderButton: handle('button'),
      handleReminderModal: handle('rsvp'),
    }),
  };
}

test('two instances with distinct guilds acknowledge each command exactly once', async () => {
  const development = instance('1180572129444507648');
  const production = instance('1382497852076462182');
  for (const guildId of ['1180572129444507648', '1382497852076462182']) {
    const { interaction, replies } = fixture('command', guildId);
    await Promise.all([development.route(interaction), production.route(interaction)]);
    assert.deepEqual(replies, [{ handledBy: guildId, handler: 'command' }]);
  }
  assert.deepEqual(development.calls, ['command']);
  assert.deepEqual(production.calls, ['command']);
});

test('foreign-guild buttons and event modals are ignored without a reply or a handler call', async () => {
  const local = instance('123');
  for (const [type, id] of [['button', 'special-rsvp:yes:1'], ['modal', 'special-rsvp:submit:1'], ['modal', 'add-event:iracing:special_event'], ['modal', 'edit-event:1']]) {
    const { interaction, replies } = fixture(type, '456', id);
    await local.route(interaction);
    assert.deepEqual(replies, []);
  }
  assert.deepEqual(local.calls, []);
});

test('DM responses route to their source guild for legacy, team, and confirmation IDs', async () => {
  const local = instance('123');
  const other = instance('456');
  const cases = [
    ['button', 'special-rsvp:yes:123:1', 'button'],
    ['button', 'special-rsvp:no:123:1', 'button'],
    ['modal', 'special-rsvp:submit:123:1', 'rsvp'],
    ['button', 'special-rsvp:yes:team:academy:123:1', 'button'],
    ['modal', 'special-rsvp:submit:team:academy:123:1', 'rsvp'],
    ['button', 'special-rsvp:confirm_yes:change:main:academy:123:1', 'button'],
    ['modal', 'special-rsvp:submit:change:main:academy:123:1', 'rsvp'],
  ];
  for (const [type, id, handler] of cases) {
    const { interaction, replies } = fixture(type, null, id);
    await Promise.all([local.route(interaction), other.route(interaction)]);
    assert.deepEqual(replies, [{ handledBy: '123', handler }]);
  }
  assert.deepEqual(other.calls, []);
});

test('owned event management and server RSVP interactions keep their existing handlers', async () => {
  const local = instance('123');
  for (const [type, id, handler] of [
    ['modal', 'add-event:iracing:special_event', 'add'],
    ['modal', 'edit-event:1', 'edit'],
    ['button', 'special-rsvp:yes:1', 'button'],
    ['modal', 'special-rsvp:submit:1', 'rsvp'],
  ]) {
    const { interaction, replies } = fixture(type, '123', id);
    await local.route(interaction);
    assert.deepEqual(replies, [{ handledBy: '123', handler }]);
  }
});

test('unscoped DMs and unknown guilds are ignored by every instance', async () => {
  const local = instance('123');
  for (const [type, guildId, id] of [
    ['command', null, undefined],
    ['command', '789', undefined],
    ['button', null, 'unrelated:123:1'],
    ['button', null, 'special-rsvp:yes:1'],
    ['modal', null, 'special-rsvp:submit:789:1'],
  ]) {
    const { interaction, replies } = fixture(type, guildId, id);
    await local.route(interaction);
    assert.deepEqual(replies, []);
  }
  assert.deepEqual(local.calls, []);
});

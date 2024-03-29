const { EmbedBuilder, ActionRowBuilder } = require('discord.js');
const { formatMessage, ButtonBuilder } = require('./utils');
const events = require('events');

async function moveMessageToThread(msg, originalMessageId, targetThreadId) {
  try {
    // Fetch the original message
    const originalMessage = await msg.channel.messages.fetch(originalMessageId);
    const messageContent = originalMessage.content; // Get the content of the original message
    const messageEmbeds = originalMessage.embeds; // Get the embeds of the original message

    console.log("targetThreadId" + targetThreadId);
    // Fetch the target thread
    const thread = await msg.channel.threads.fetch(targetThreadId);

    // Check if the fetched thread is a valid ThreadChannel object
    if (!thread || !thread.send || typeof thread.send !== 'function') {
      throw new Error('Invalid or unexpected thread object.');
    }
    // Send a new message in the target thread with similar content or modifications
    const sentMessage = await thread.send({
      content: messageContent,
      embeds: messageEmbeds
    });

    console.log(`Message moved to thread ${targetThreadId}: ${sentMessage.content}`);
    return sentMessage; // Return the sent message object if needed
  } catch (error) {
    console.error('Error moving message to thread:', error);
    throw new Error('Error moving message to thread.');
  }
}

// Author: Alex Wanjohi
async function deleteThread(msg, threadId) {
  try {
    const thread = msg.channel;

    if (thread && thread.isThread()) {
      // Delete the thread
      await thread.delete();
      console.log('Thread deleted successfully.');
    } else {
      console.log('Invalid thread ID or the channel is not a thread.');
    }
  } catch (error) {
    console.error('Error deleting the thread:', error);
  }
}

module.exports = class Approve extends events {
  constructor(options = {}) {

    if (!options.embed) options.embed = {};
    if (!options.embed.requestTitle) options.embed.requestTitle = options.embed.title;
    if (!options.embed.requestColor) options.embed.requestColor = options.embed.color;
    if (!options.embed.rejectTitle) options.embed.rejectTitle = options.embed.title;
    if (!options.embed.rejectColor) options.embed.rejectColor = options.embed.color;

    if (!options.buttons) options.buttons = {};
    if (!options.buttons.accept) options.buttons.accept = 'Accept';
    if (!options.buttons.reject) options.buttons.reject = 'Reject';

    if (!options.reqTimeoutTime) options.reqTimeoutTime = 86400000;
    if (typeof options.mentionUser === 'undefined') options.mentionUser = false;
    if (!options.requestMessage) options.requestMessage = '{player} has invited you for a round of Game.';
    if (!options.rejectMessage) options.rejectMessage = 'The player denied your request for a round of Game.';
    if (!options.reqTimeoutMessage) options.reqTimeoutMessage = 'Dropped the game as the player did not respond.';

    super();
    this.options = options;
    this.message = options.message;
    this.opponent = options.opponent;
    this.threadId = options.threadId;
  }


  async sendMessage(content) {
    if (this.options.isSlashGame) return await this.message.editReply(content).catch(e => {});
    else return await this.message.channel.send(content).catch(e => {});
  }


  async approve() {
    return new Promise(async resolve => {

      const embed = new EmbedBuilder()
      .setColor(this.options.embed.requestColor)
      .setTitle(this.options.embed.requestTitle)
      .setDescription(formatMessage(this.options, 'requestMessage'));

      const btn1 = new ButtonBuilder().setLabel(this.options.buttons.accept).setCustomId('approve_accept').setStyle('SUCCESS');
      const btn2 = new ButtonBuilder().setLabel(this.options.buttons.reject).setCustomId('approve_reject').setStyle('DANGER');
      const row = new ActionRowBuilder().addComponents(btn1, btn2);

      const content = this.options.mentionUser ? '<@!'+this.opponent.id+'>' : null;

      const thread = await this.message.channel.threads.fetch(this.threadId);

      let msg;
      if (thread.isThread()) {
        msg = await thread.send({
          content, embeds: [embed], components: [row], allowedMentions: { parse: ['users'] }
        });

        console.log(`Message sent in the private thread with ID: ${thread.id}`);
      } else {
        console.log('Invalid thread ID or the channel is not a thread.');
      }

      //const msg = await this.sendMessage({ content, embeds: [embed], components: [row], allowedMentions: { parse: ['users'] } });
      //const collector = msg.createMessageComponentCollector({ time: this.options.reqTimeoutTime });

      const cleanContent = content.replace(/<@!?\d+>/g, ''); // This regex removes user mentions

      // const msg = await this.sendMessage({ content, embeds: [embed], components: [row], allowedMentions: { parse: ['users'] }, thread: this.threadId });
      await this.sendMessage({ cleanContent, embeds: [embed], components: [], allowedMentions: { parse: [] }, thread: this.threadId });
      const collector = msg.createMessageComponentCollector({ time: this.options.reqTimeoutTime });


      collector.on('collect', async btn => {
        await btn.deferUpdate().catch(e => {});
        if (btn.user.id === this.opponent.id) collector.stop(btn.customId.split('_')[1]);
      })

      collector.on('end', async (_, reason) => {
        //console.log( 'Reason: ' + reason );
        if (reason === 'accept'){
          // Author: Alex Wanjohi
          this.emit('gameAccept', { result: reason, player: this.message.author, opponent: this.opponent });

          return resolve(msg);
        };


        // Author: Alex Wanjohi
        if (reason === 'timeout') {
          this.emit('gameTimeOut', { result: reason, player: this.message.author, opponent: this.opponent, msg: msg, threadId: this.threadId });

          deleteThread( msg, this.threadId );

          return resolve(false);
        }


        if (reason === 'reject') {
          // Author: Alex Wanjohi
          this.emit('gameReject', { result: reason, player: this.message.author, opponent: this.opponent, msg: msg, threadId: this.threadId  });

          deleteThread( msg, this.threadId );

          return resolve(false);
        }

          const embed = new EmbedBuilder()
            .setColor(this.options.embed.rejectColor)
            .setTitle(this.options.embed.rejectTitle)
            .setDescription(formatMessage(this.options, 'rejectMessage'))

        if (reason === 'time'){
          embed.setDescription(formatMessage(this.options, 'reqTimeoutMessage'))

          this.emit('gameTimeOut', { result: reason, player: this.message.author, opponent: this.opponent, msg: msg, threadId: this.threadId });

          deleteThread( msg, this.threadId );

          return;
        }

        this.emit('gameOver', { result: reason, player: this.message.author, opponent: this.opponent, msg: msg, threadId: this.threadId });
        await msg.edit({ content: null, embeds: [embed], components: [], thread: this.threadId })
            .then(sentMessage => {
              // Handle the sent message if needed
              const originalMessageId = msg.id; // Replace with the actual original message ID
              const targetThreadId = this.threadId; // Replace with the actual target thread ID

              console.log("originalMessageId " + originalMessageId);
              console.log("this.threadId " + this.threadId);

              moveMessageToThread(this.message, originalMessageId, targetThreadId)
                  .then(sentMessage => {
                    // Handle the sent message if needed
                  })
                  .catch(error => {
                    // Handle errors
                  });

            })
            .catch(error => {
              // Handle errors
            });

        //deleteThread( msg, this.threadId );

        return resolve(false);
      })
    })
  }


  formatTurnMessage(options, contentMsg) {
    const { message, opponent } = options;
    let player1 = (!this.player1Turn) ? opponent : message.author;
    let content = options[contentMsg];

    content = content.replace('{player.tag}', player1.tag).replace('{player.username}', player1.username).replace('{player}', `<@!${player1.id}>`);
    content = content.replace('{opponent.tag}', opponent.tag).replace('{opponent.username}', opponent.username).replace('{opponent}', `<@!${opponent.id}>`);
    return content;
  }
}


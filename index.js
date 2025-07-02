
const { Client, GatewayIntentBits, SlashCommandBuilder, REST, Routes, EmbedBuilder } = require('discord.js');
const axios = require('axios');
require('dotenv').config();

// Bot configuration
const client = new Client({ 
    intents: [GatewayIntentBits.Guilds] 
});

// Environment variables
const DISCORD_TOKEN = "Thêm token bot ở đây";

// User-specific storage for monitored URLs
// Structure: { userId: { urlMap, checkHistory } }
const userMonitoringData = new Map();

// Cooldown system
const cooldowns = new Map();

// Helper function to get or create user data
function getUserData(userId) {
    if (!userMonitoringData.has(userId)) {
        userMonitoringData.set(userId, {
            monitoredUrls: new Map(),
            checkHistory: new Map()
        });
    }
    return userMonitoringData.get(userId);
}

// URL monitoring function
async function checkUrlStatus(url) {
    const startTime = Date.now();
    try {
        const response = await axios.get(url, { 
            timeout: 10000,
            validateStatus: function (status) {
                return status < 500; // Accept any status code below 500 as success
            }
        });
        return {
            status: 'online',
            statusCode: response.status,
            responseTime: Date.now() - startTime,
            timestamp: new Date()
        };
    } catch (error) {
        return {
            status: 'offline',
            error: error.message,
            responseTime: Date.now() - startTime,
            timestamp: new Date()
        };
    }
}

// Monitor URLs continuously for all users
async function startMonitoring() {
    setInterval(async () => {
        for (const [userId, userData] of userMonitoringData) {
            for (const [url, urlData] of userData.monitoredUrls) {
                const result = await checkUrlStatus(url);
                
                // Update URL data
                urlData.lastCheck = result.timestamp;
                urlData.status = result.status;
                urlData.totalChecks++;
                
                if (result.status === 'online') {
                    urlData.uptimeCount++;
                    urlData.lastOnline = result.timestamp;
                } else {
                    urlData.lastOffline = result.timestamp;
                }
                
                // Store check history (keep last 50 checks)
                if (!userData.checkHistory.has(url)) {
                    userData.checkHistory.set(url, []);
                }
                const history = userData.checkHistory.get(url);
                history.push(result);
                if (history.length > 50) {
                    history.shift();
                }
            }
        }
    }, 60000); // Check every minute
}

// Slash commands
const commands = [
    new SlashCommandBuilder()
        .setName('monitor-add')
        .setDescription('Add a URL to your personal monitoring list')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to monitor')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('monitor-check')
        .setDescription('Check the status of one of your monitored URLs')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to check')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('monitor-list')
        .setDescription('List all your monitored URLs'),
    
    new SlashCommandBuilder()
        .setName('monitor-remove')
        .setDescription('Remove a URL from your monitoring list')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to remove')
                .setRequired(true)),
    
    new SlashCommandBuilder()
        .setName('monitor-stats')
        .setDescription('Get your uptime monitoring statistics'),
    
    new SlashCommandBuilder()
        .setName('monitor-history')
        .setDescription('Get check history for one of your monitored URLs')
        .addStringOption(option =>
            option.setName('url')
                .setDescription('The URL to get history for')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('limit')
                .setDescription('Number of recent checks to show (default: 10)')
                .setMinValue(1)
                .setMaxValue(50)),
    
    new SlashCommandBuilder()
        .setName('bot')
        .setDescription('Bot related commands')
        .addSubcommand(subcommand =>
            subcommand
                .setName('invite')
                .setDescription("Get bot's invite link")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('stats')
                .setDescription("Get bot's statistics")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('uptime')
                .setDescription("Get bot's uptime")
        )
        .addSubcommand(subcommand =>
            subcommand
                .setName('ping')
                .setDescription("Check bot's ping and latency")
        )
];

// Register slash commands
const rest = new REST({ version: '10' }).setToken(DISCORD_TOKEN);

async function registerCommands() {
    try {
        console.log('Started refreshing application (/) commands.');
        
        await rest.put(
            Routes.applicationCommands(client.user.id),
            { body: commands }
        );
        
        console.log('Successfully reloaded application (/) commands.');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Helper function to create status embed
function createStatusEmbed(title, data, color = 0x00ff00) {
    return new EmbedBuilder()
        .setTitle(title)
        .setColor(color)
        .setTimestamp()
        .setFooter({ text: 'Personal Uptime Monitor Bot' });
}

// Bot event handlers
client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    await registerCommands();
    startMonitoring();
    console.log('Personal URL monitoring service started - checking every minute');
});

client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand()) return;

    // Check if command is used in DM (guild-only restriction)
    if (!interaction.guild) {
        const embed = createStatusEmbed('Guild Only Command', 'Cannot use command in DM. Please use this command in a server.', 0xff0000);
        await interaction.reply({ embeds: [embed], ephemeral: true });
        return;
    }

    const { commandName } = interaction;
    const userId = interaction.user.id;
    const userData = getUserData(userId);

    // Cooldown system
    if (!cooldowns.has(commandName)) {
        cooldowns.set(commandName, new Map());
    }

    const now = Date.now();
    const timestamps = cooldowns.get(commandName);
    const cooldownAmount = 3000; // 3 seconds in milliseconds

    if (timestamps.has(userId)) {
        const expirationTime = timestamps.get(userId) + cooldownAmount;

        if (now < expirationTime) {
            const timeLeft = (expirationTime - now) / 1000;
            const embed = createStatusEmbed('Cooldown Active', `Please wait ${timeLeft.toFixed(1)} seconds before using this command again!`, 0xffaa00);
            await interaction.reply({ embeds: [embed], ephemeral: true });
            return;
        }
    }

    timestamps.set(userId, now);
    setTimeout(() => timestamps.delete(userId), cooldownAmount);

    try {
        switch (commandName) {
            case 'monitor-add': {
                const url = interaction.options.getString('url');
                
                // Validate URL
                try {
                    new URL(url);
                } catch (error) {
                    const embed = createStatusEmbed('Invalid URL', 'Please provide a valid URL (including http:// or https://)', 0xff0000);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    return;
                }
                
                if (userData.monitoredUrls.has(url)) {
                    const embed = createStatusEmbed('URL Already Monitored', `${url} is already in your monitoring list.`, 0xffaa00);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    return;
                }
                
                // Add URL to user's monitoring
                userData.monitoredUrls.set(url, {
                    addedBy: userId,
                    addedAt: new Date(),
                    lastCheck: null,
                    status: 'pending',
                    totalChecks: 0,
                    uptimeCount: 0,
                    lastOnline: null,
                    lastOffline: null
                });
                
                await interaction.deferReply();
                
                // Immediately check the URL status
                const result = await checkUrlStatus(url);
                
                // Update URL data with initial check
                const urlData = userData.monitoredUrls.get(url);
                urlData.lastCheck = result.timestamp;
                urlData.status = result.status;
                urlData.totalChecks++;
                
                if (result.status === 'online') {
                    urlData.uptimeCount++;
                    urlData.lastOnline = result.timestamp;
                } else {
                    urlData.lastOffline = result.timestamp;
                }
                
                // Store initial check in history
                if (!userData.checkHistory.has(url)) {
                    userData.checkHistory.set(url, []);
                }
                userData.checkHistory.get(url).push(result);
                
                const statusIcon = result.status === 'online' ? '🟢' : '🔴';
                const color = result.status === 'online' ? 0x00ff00 : 0xff0000;
                
                const embed = createStatusEmbed('URL Added to Your Monitoring', null, color)
                    .addFields(
                        { name: 'URL', value: url },
                        { name: 'Initial Status', value: `${statusIcon} ${result.status.toUpperCase()}`, inline: true },
                        { name: 'Response Time', value: `${result.responseTime}ms`, inline: true }
                    )
                    .setDescription('✅ URL has been added to your personal 24/7 monitoring and checked immediately.');
                
                if (result.statusCode) {
                    embed.addFields({ name: 'Status Code', value: result.statusCode.toString(), inline: true });
                }
                
                if (result.error) {
                    embed.addFields({ name: 'Error', value: result.error });
                }
                
                await interaction.editReply({ embeds: [embed] });
                break;
            }
            
            case 'monitor-check': {
                const url = interaction.options.getString('url');
                
                if (!userData.monitoredUrls.has(url)) {
                    const embed = createStatusEmbed('URL Not Found', `${url} is not in your monitoring list. Use /monitor-add to start monitoring.`, 0xffaa00);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    return;
                }
                
                await interaction.deferReply();
                
                const result = await checkUrlStatus(url);
                
                const urlData = userData.monitoredUrls.get(url);
                const uptime = urlData.totalChecks > 0 ? ((urlData.uptimeCount / urlData.totalChecks) * 100).toFixed(2) : '0.00';
                
                const color = result.status === 'online' ? 0x00ff00 : 0xff0000;
                const statusIcon = result.status === 'online' ? '🟢' : '🔴';
                
                const embed = createStatusEmbed(`${statusIcon} Your URL Status Check`, null, color)
                    .addFields(
                        { name: 'URL', value: url },
                        { name: 'Status', value: result.status.toUpperCase(), inline: true },
                        { name: 'Response Time', value: `${result.responseTime}ms`, inline: true },
                        { name: 'Uptime', value: `${uptime}%`, inline: true }
                    );
                
                if (result.statusCode) {
                    embed.addFields({ name: 'Status Code', value: result.statusCode.toString(), inline: true });
                }
                
                if (result.error) {
                    embed.addFields({ name: 'Error', value: result.error });
                }
                
                await interaction.editReply({ embeds: [embed] });
                break;
            }
            
            case 'monitor-list': {
                if (userData.monitoredUrls.size === 0) {
                    const embed = createStatusEmbed('No Monitored URLs', 'You have no URLs being monitored. Use /monitor-add to start monitoring URLs.', 0xffaa00);
                    await interaction.reply({ embeds: [embed] });
                    return;
                }
                
                const embed = createStatusEmbed('Your Monitored URLs', `You are monitoring ${userData.monitoredUrls.size} URL(s)`, 0x0099ff);
                
                let urlList = '';
                for (const [url, data] of userData.monitoredUrls) {
                    const statusIcon = data.status === 'online' ? '🟢' : data.status === 'offline' ? '🔴' : '⚪';
                    const uptime = data.totalChecks > 0 ? ((data.uptimeCount / data.totalChecks) * 100).toFixed(1) : '0.0';
                    urlList += `${statusIcon} ${url} (${uptime}% uptime)\n`;
                }
                
                embed.setDescription(urlList);
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            case 'monitor-remove': {
                const url = interaction.options.getString('url');
                
                if (!userData.monitoredUrls.has(url)) {
                    const embed = createStatusEmbed('URL Not Found', `${url} is not in your monitoring list.`, 0xffaa00);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    return;
                }
                
                userData.monitoredUrls.delete(url);
                userData.checkHistory.delete(url);
                
                const embed = createStatusEmbed('URL Removed', null, 0x00ff00)
                    .addFields({ name: 'URL', value: url })
                    .setDescription('✅ URL has been removed from your monitoring list.');
                
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            case 'monitor-stats': {
                if (userData.monitoredUrls.size === 0) {
                    const embed = createStatusEmbed('No Statistics Available', 'You have no URLs being monitored.', 0xffaa00);
                    await interaction.reply({ embeds: [embed] });
                    return;
                }
                
                let totalChecks = 0;
                let totalUptime = 0;
                let onlineCount = 0;
                
                for (const [url, data] of userData.monitoredUrls) {
                    totalChecks += data.totalChecks;
                    totalUptime += data.uptimeCount;
                    if (data.status === 'online') onlineCount++;
                }
                
                const overallUptime = totalChecks > 0 ? ((totalUptime / totalChecks) * 100).toFixed(2) : '0.00';
                
                const embed = createStatusEmbed('Your Monitoring Statistics', null, 0x0099ff)
                    .addFields(
                        { name: 'Your URLs', value: userData.monitoredUrls.size.toString(), inline: true },
                        { name: 'Online URLs', value: onlineCount.toString(), inline: true },
                        { name: 'Your Overall Uptime', value: `${overallUptime}%`, inline: true },
                        { name: 'Total Checks', value: totalChecks.toString(), inline: true }
                    );
                
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            case 'monitor-history': {
                const url = interaction.options.getString('url');
                const limit = interaction.options.getInteger('limit') || 10;
                
                if (!userData.monitoredUrls.has(url)) {
                    const embed = createStatusEmbed('URL Not Found', `${url} is not in your monitoring list.`, 0xffaa00);
                    await interaction.reply({ embeds: [embed], ephemeral: true });
                    return;
                }
                
                const history = userData.checkHistory.get(url) || [];
                
                if (history.length === 0) {
                    const embed = createStatusEmbed('No History Available', 'No check history available yet for this URL.', 0xffaa00);
                    await interaction.reply({ embeds: [embed] });
                    return;
                }
                
                const recentHistory = history.slice(-limit).reverse();
                
                const embed = createStatusEmbed(`Check History for ${url}`, `Showing last ${recentHistory.length} checks`, 0x0099ff);
                
                let historyText = '';
                for (const check of recentHistory) {
                    const statusIcon = check.status === 'online' ? '🟢' : '🔴';
                    const time = check.timestamp.toLocaleTimeString();
                    const responseTime = check.responseTime ? ` (${check.responseTime}ms)` : '';
                    historyText += `${statusIcon} ${time} - ${check.status.toUpperCase()}${responseTime}\n`;
                }
                
                embed.setDescription(historyText || 'No history available');
                await interaction.reply({ embeds: [embed] });
                break;
            }
            
            case 'bot': {
                const subcommand = interaction.options.getSubcommand();
                
                switch (subcommand) {
                    case 'invite': {
                        const inviteUrl = `https://discord.com/api/oauth2/authorize?client_id=${client.user.id}&permissions=536870928&scope=bot%20applications.commands`;
                        
                        const embed = createStatusEmbed('Bot Invite Link', null, 0x0099ff)
                            .addFields({ name: 'Invite URL', value: `[Click here to invite the bot](${inviteUrl})` })
                            .setDescription('Use this link to invite the bot to other servers!');
                        
                        await interaction.reply({ embeds: [embed] });
                        break;
                    }
                    
                    case 'stats': {
                        let totalUsers = 0;
                        let totalUrls = 0;
                        
                        for (const [userId, userData] of userMonitoringData) {
                            if (userData.monitoredUrls.size > 0) {
                                totalUsers++;
                                totalUrls += userData.monitoredUrls.size;
                            }
                        }
                        
                        const embed = createStatusEmbed('Bot Statistics', null, 0x0099ff)
                            .addFields(
                                { name: 'Servers', value: client.guilds.cache.size.toString(), inline: true },
                                { name: 'Active Users', value: totalUsers.toString(), inline: true },
                                { name: 'Ping', value: `${client.ws.ping}ms`, inline: true },
                                { name: 'Total Monitored URLs', value: totalUrls.toString(), inline: true }
                            );
                        
                        await interaction.reply({ embeds: [embed] });
                        break;
                    }
                    
                    case 'uptime': {
                        const uptime = process.uptime();
                        const hours = Math.floor(uptime / 3600);
                        const minutes = Math.floor((uptime % 3600) / 60);
                        const seconds = Math.floor(uptime % 60);
                        
                        const embed = createStatusEmbed('Bot Uptime', null, 0x0099ff)
                            .addFields({ name: 'Uptime', value: `${hours}h ${minutes}m ${seconds}s` });
                        
                        await interaction.reply({ embeds: [embed] });
                        break;
                    }
                    
                    case 'ping': {
                        const sent = await interaction.reply({ content: 'Pinging...', fetchReply: true });
                        const timeDiff = sent.createdTimestamp - interaction.createdTimestamp;
                        
                        const embed = createStatusEmbed('🏓 Pong!', null, 0x00ff00)
                            .addFields(
                                { name: 'Latency', value: `${timeDiff}ms`, inline: true },
                                { name: 'API Latency', value: `${client.ws.ping}ms`, inline: true }
                            )
                            .setDescription(`Pong! Latency is ${timeDiff}ms. API Latency is ${client.ws.ping}ms.`);
                        
                        await interaction.editReply({ content: '', embeds: [embed] });
                        break;
                    }
                }
                break;
            }
        }
    } catch (error) {
        console.error('Command error:', error);
        
        const errorEmbed = createStatusEmbed('Error', error.message, 0xff0000);
        
        if (interaction.deferred) {
            await interaction.editReply({ embeds: [errorEmbed] });
        } else {
            await interaction.reply({ embeds: [errorEmbed], ephemeral: true });
        }
    }
});

// Start the bot
if (!DISCORD_TOKEN) {
    console.error('Missing DISCORD_TOKEN environment variable. Please check your .env file.');
    process.exit(1);
}

client.login(DISCORD_TOKEN);

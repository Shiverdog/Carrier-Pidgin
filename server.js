const { Client } = require('discord.js')
const { Octokit } = require("@octokit/core");

const client = new Client({
    intents: (1 << 0) + (1 << 9) + (1 << 15) + (1 << 1),
    presence: {
        activities: [{
            name: 'for @Pidgin',
            type: 3
        }]
    }
})

const procedure_regex = /(open|reply|close)-(\d+) ?/;

const config = require('./Config.json')
// Octokit.js
// https://github.com/octokit/core.js#readme
let octokits = {}
Object.keys(config.github_users).forEach(i => {
	octokit = new Octokit({
	  auth: config.github_users[i].token
	})
	octokits[i] = octokit
})
console.log(octokits)

client.on('ready', () => {
    console.log(`${client.user.tag} is ready!`)
})

client.on('messageCreate', message => {
    handle(message)
})

// Message incoming! What do we do with it?
async function handle(message) {
	if (!message.channel.guild) return;
	if (message?.member?.user == client.user) return; // don't reply to self
	let log = [];
	
	// Are we summoning Pidgin?
	let summoned;
	// Pattern Shortcut
	if(config.pattern_shortcuts) {
		let pattern_shortcut;
		config.pattern_shortcuts.forEach(i => {
			if (!pattern_shortcut) {
				pattern_shortcut = message.content.match(new RegExp(i))
			}
		})
		if(pattern_shortcut) {
			summoned = "pattern";
		}
	}
	// Ping Shortcut
	if(!summoned) {
		if(config.ping_shortcut) {
			if(message.mentions.has(client.user)) {
				summoned = "ping";
			}
		}
	}
	if(!summoned) return;
	
	// Get default repo and repo from channel topic
	let pathmatch = message?.channel?.topic?.match(/<pidginRepo: ?(.+?)\/(.+?)>/i)
	let usermatch = message?.channel?.topic?.match(/<pidginUser: ?(.+?)>/i)[1]
	console.log(usermatch)
	// Defaults user
	if (!usermatch) {
		if(config.default_github_user) {
			usermatch = config.default_github_user
		} else {
			log.push((config.error_emoji || ":x:")+" Error: User is not specified, and no default is set.")
			log_reply(message,log)
			return
		}
	}
	// Verify user exists
	let default_user = config.default_github_user
	if(!config.github_users[default_user]) {
		log.push((config.warn_emoji || ":warning:") +" Warning: Default user `"+default_user+"` is not configured! Proceeding with no default user.")
		default_user = null;
	}
	while(true) { // until we find a working user or determine that no default is acceptable
		if (!config.github_users[usermatch]) {
			if(default_user) {
				log.push((config.warn_emoji || ":warning:")+" Warning: User `"+usermatch+"` is not configured! Falling back to `"+default_user+"`")
				console.log(log)
				usermatch = default_user
			} else {
				log.push((config.error_emoji || ":x:")+" Error: User `"+usermatch+"` is not configured, and no default is set.")
				log_reply(message,log)
				return
			}
		} else {
			break
		}
	}
	// Default repo
	if (!pathmatch) {
		pathmatch = config.github_users[usermatch].default_repo.split("/")
	} else {
		pathmatch.shift()
		// pathmatch should be: [user, repo], but regex matching has an element before those
	}
	if(config.github_users[usermatch].whitelisted_roles) {
		if(message.webhookId) {
			console.log(!config.github_users[usermatch].whitelisted_webhooks)
			if (!config.github_users[usermatch].whitelisted_webhooks) {
				// Whitelisted webhooks is not defined, so all webhooks must fail
				log.push((config.whitelist_emoji || ":no_entry:")+" No webhooks are whitelisted for user `"+usermatch+"`.")
				log_reply(message,log)
				return
			}
			if (!(config.github_users[usermatch].whitelisted_webhooks === true)) {
				// Whitelisted webhooks is not set to literal true. If it were, all webhooks would pass.
				if (!config.github_users[usermatch].whitelisted_webhooks.includes(message.webhookId)) {
					// Webhook is not whitelisted so it should fail
					log.push((config.whitelist_emoji || ":no_entry:")+" The webhook `"+message.webhookId+"` is not whitelisted for user `"+usermatch+"`.")
					log_reply(message,log)
					return
				}
			}
		} else {
			// Whitelisted roles (guild member)
			if (!message?.member?.roles.cache.some(role => config.github_users[usermatch].whitelisted_roles.includes(role.id))) {
				log.push((config.whitelist_emoji || ":no_entry:") + " A whitelist is set up, but you do not have a whitelisted role")
				log_reply(message,log)
				return
			}
		}
	}
	
	// Whitelisted repos
	let whitelisted_repo;
	// Default repo?
	if(config.github_users[usermatch].default_repo) {
		let default_user = config.github_users[usermatch].default_repo.split("/")[0]
		let default_repo = config.github_users[usermatch].default_repo.split("/")[1]
		if(pathmatch[0] == default_user && pathmatch[1] == default_repo) {
			whitelisted_repo = true;
		}
	}
	if(!whitelisted_repo) {
		config.github_users[usermatch].whitelisted_repos.forEach(i => {
			if(!whitelisted_repo) {
				let i_user = i.split("/")[0]
				let i_repo = i.split("/")[1]
				if (!i_repo) i_repo = "*"
				if (i_user == "*" || pathmatch[0] == i_user) {
					if (i_repo == "*" || pathmatch[1] == i_repo) {
						whitelisted_repo = true
					}
				}
			}
		})
	}
	if (!whitelisted_repo) {
		log.push((config.error_emoji || ":x:")+ " Repository `"+pathmatch[0]+"/"+pathmatch[1]+"` not whitelisted for user `"+usermatch+"`.")
		log_reply(message,log,true)
		return
	}
	
	// Pattern Shortcut
	if(summoned == "pattern") {
		let pattern_shortcut;
		config.pattern_shortcuts.forEach(i => {
			if (!pattern_shortcut) {
				pattern_shortcut = message.content.match(new RegExp(i))
			}
		})
		if(pattern_shortcut) {
			let author = pattern_shortcut.groups?.author || message?.member?.user?.username
			let content = pattern_shortcut.groups?.content
			let output = await manage(pathmatch,message,author,content,usermatch)
			log.push(output)
			log_reply(message,log,true)
			return
		}
	}
	// Ping Shortcut
	else if(summoned == "ping") {
		if(message.mentions.has(client.user)) {
			let output = await manage(pathmatch,message,message.member.user.username,message.content.replace(/<.+?> ?/, ""),usermatch)
			log.push(output)
			log_reply(message,log,true)
			return
		}
	}
}
function log_reply(message,log,past_whitelist) {
	if(!past_whitelist) {
		if(config.whitelist_error_messages === false) {
			message.react(config.whitelist_emoji || ":no_entry:")
			return
		}
	}
	message.reply(log.join("\n")).catch(console.log)
}

// The handle() function wanted us to interface with the GitHub API.
// Before we talk to GitHub, figure out what do we need to do. Create an issue? Reply?
async function manage(pathmatch,message,author,content,user) {
	if(!content) {
		return (config.error_emoji || ":x:")+" Error: No content provided"
	}
	let procedure = content.match(procedure_regex) // Does it contain a prodcedure like "close-17"?
	if(procedure) {
		content = content.replace(procedure_regex, "") // Remove procedure tag
		let close;
		if(procedure[1] == "close") {
			close = true;
		} else if (procedure[1] == "open") {
			close = false
		}
		issue = Number(procedure[2])
		// reply only if there's content or author snitching disabled
		let url;
		if(content || !config.show_author)
		{
			const result_1 = await reply(pathmatch,author,content,issue,user)
			url = result_1?.data?.html_url
		}
		const result_2 = await update(pathmatch,author,content,issue,close,user)
		url = url || result_2?.data?.html_url
		if (result) {
			return (config.success_emoji || ":dove:")+" [Issue "+issue+"](<"+url+">)"
		} else {
			return (config.error_emoji || ":x:")+" Error: GitHub API Error"
		}
	} else {
		const result = await todo(pathmatch,author,content,user)
		let url = result?.data?.html_url
		if(result) {
			return (config.success_emoji || ":dove:")+" [Issue "+result?.data?.number+"](<"+url+">) \""+content+"\""
		} else {
			return (config.error_emoji || ":x:")+" Error: GitHub API Error"
		}
	}
}

async function todo(pathmatch,author,content,user) {
	const response = await octokits[user].request('POST /repos/'+pathmatch[0]+'/'+pathmatch[1]+'/issues', {
	  owner: pathmatch[0],
	  repo: pathmatch[1],
	  title: content,
	  body: 'Author: '+author,
	  labels: [],
	  headers: {
		'X-GitHub-Api-Version': '2022-11-28'
	  }
	}).catch(console.log)
	return response;
}

async function reply(pathmatch,author,content,issue,user) {
	if (!(config.show_author === false)) {
		content = content + "\nAuthor: "+author
	}
	const response = await octokits[user].request('POST /repos/'+pathmatch[0]+'/'+pathmatch[1]+'/issues/'+issue+'/comments', {
	  owner: pathmatch[0],
	  repo: pathmatch[1],
	  issue_number: issue,
	  body: content,
	  headers: {
		'X-GitHub-Api-Version': '2022-11-28'
	  }
	}).catch(console.log)
	return response;
}

async function update(pathmatch,author,content,issue,close,user) {
	const response = await octokits[user].request('PATCH /repos/'+pathmatch[0]+'/'+pathmatch[1]+'/issues/'+issue, {
	  owner: pathmatch[0],
	  repo: pathmatch[1],
	  issue_number: issue,
	  state: close,
	  headers: {
		'X-GitHub-Api-Version': '2022-11-28'
	  }
	}).catch(console.log)
	
	return response;
}

client.login(config.bot_token)
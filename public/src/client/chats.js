'use strict';


define('forum/chats', [
	'components',
	'translator',
	'mousetrap',
	'forum/chats/recent',
	'forum/chats/search',
	'forum/chats/messages',
	'benchpress',
], function (components, translator, mousetrap, recentChats, search, messages, Benchpress) {
	var Chats = {
		initialised: false,
	};

	var newMessage = false;

	Chats.init = function () {
		var env = utils.findBootstrapEnvironment();

		if (!Chats.initialised) {
			Chats.addSocketListeners();
			Chats.addGlobalEventListeners();
		}

		recentChats.init();

		Chats.addEventListeners();
		Chats.createTagsInput($('[component="chat/messages"] .users-tag-input'), ajaxify.data);
		Chats.createAutoComplete($('[component="chat/input"]'));
		Chats.resizeMainWindow();

		if (env === 'md' || env === 'lg') {
			Chats.addHotkeys();
		}

		messages.scrollToBottom($('.expanded-chat ul.chat-content'));

		Chats.initialised = true;

		search.init();

		if (ajaxify.data.hasOwnProperty('roomId')) {
			components.get('chat/input').focus();
		}
	};

	Chats.addEventListeners = function () {
		Chats.addSendHandlers(ajaxify.data.roomId, $('.chat-input'), $('.expanded-chat button[data-action="send"]'));
		Chats.addPopoutHandler();
		Chats.addActionHandlers(components.get('chat/messages'), ajaxify.data.roomId);
		Chats.addMemberHandler(ajaxify.data.roomId, components.get('chat/controls').find('[data-action="members"]'));
		Chats.addRenameHandler(ajaxify.data.roomId, components.get('chat/controls').find('[data-action="rename"]'));
		Chats.addScrollHandler(ajaxify.data.roomId, ajaxify.data.uid, $('.chat-content'));
		Chats.addCharactersLeftHandler($('[component="chat/main-wrapper"]'));
	};

	Chats.addPopoutHandler = function () {
		$('[data-action="pop-out"]').on('click', function () {
			var text = components.get('chat/input').val();
			var roomId = ajaxify.data.roomId;

			if (app.previousUrl && app.previousUrl.match(/chats/)) {
				ajaxify.go('user/' + ajaxify.data.userslug + '/chats', function () {
					app.openChat(roomId, ajaxify.data.uid);
				}, true);
			} else {
				window.history.go(-1);
				app.openChat(roomId, ajaxify.data.uid);
			}

			$(window).one('action:chat.loaded', function () {
				components.get('chat/input').val(text);
			});
		});
	};

	Chats.addScrollHandler = function (roomId, uid, el) {
		var loading = false;
		el.off('scroll').on('scroll', function () {
			if (loading) {
				return;
			}

			var top = (el[0].scrollHeight - el.height()) * 0.1;
			if (el.scrollTop() >= top) {
				return;
			}
			loading = true;
			var start = parseInt(el.children('[data-mid]').length, 10);
			socket.emit('modules.chats.getMessages', {
				roomId: roomId,
				uid: uid,
				start: start,
			}, function (err, data) {
				if (err) {
					return app.alertError(err.message);
				}
				if (!data) {
					return;
				}
				messages.parseMessage(data, function (html) {
					var currentScrollTop = el.scrollTop();
					var previousHeight = el[0].scrollHeight;
					html = $(html);
					el.prepend(html);
					html.find('.timeago').timeago();
					html.find('img:not(.not-responsive)').addClass('img-responsive');
					el.scrollTop((el[0].scrollHeight - previousHeight) + currentScrollTop);
					loading = false;
				});
			});
		});
	};

	Chats.addCharactersLeftHandler = function (parent) {
		var element = parent.find('[component="chat/input"]');
		element.on('keyup', function () {
			parent.find('[component="chat/message/length"]').text(element.val().length);
			parent.find('[component="chat/message/remaining"]').text(config.maximumChatMessageLength - element.val().length);
		});
	};

	Chats.addActionHandlers = function (element, roomId) {
		element.on('click', '[data-action]', function () {
			var messageId = $(this).parents('[data-mid]').attr('data-mid');
			var action = this.getAttribute('data-action');

			switch (action) {
			case 'edit':
				var inputEl = $('[data-roomid="' + roomId + '"] [component="chat/input"]');
				messages.prepEdit(inputEl, messageId, roomId);
				break;

			case 'delete':
				messages.delete(messageId, roomId);
				break;

			case 'restore':
				messages.restore(messageId, roomId);
				break;
			}
		});
	};

	Chats.addHotkeys = function () {
		mousetrap.bind('ctrl+up', function () {
			var activeContact = $('.chats-list .bg-info');
			var prev = activeContact.prev();

			if (prev.length) {
				Chats.switchChat(prev.attr('data-roomid'));
			}
		});
		mousetrap.bind('ctrl+down', function () {
			var activeContact = $('.chats-list .bg-info');
			var next = activeContact.next();

			if (next.length) {
				Chats.switchChat(next.attr('data-roomid'));
			}
		});
		mousetrap.bind('up', function (e) {
			if (e.target === components.get('chat/input').get(0)) {
				// Retrieve message id from messages list
				var message = components.get('chat/messages').find('.chat-message[data-self="1"]').last();
				var lastMid = message.attr('data-mid');
				var inputEl = components.get('chat/input');

				messages.prepEdit(inputEl, lastMid, ajaxify.data.roomId);
			}
		});
	};

	Chats.addMemberHandler = function (roomId, buttonEl) {
		var modal;

		buttonEl.on('click', function () {
			Benchpress.parse('partials/modals/manage_room', {}, function (html) {
				translator.translate(html, function (html) {
					modal = bootbox.dialog({
						title: '[[modules:chat.manage-room]]',
						message: html,
					});

					modal.attr('component', 'chat/manage-modal');

					socket.emit('modules.chats.getUsersInRoom', { roomId: roomId }, function (err, users) {
						var listEl = modal.find('.list-group');

						if (err) {
							return translator.translate('[[error:invalid-data]]', function (translated) {
								listEl.find('li').text(translated);
							});
						}

						Benchpress.parse('partials/modals/manage_room_users', {
							users: users,
						}, function (html) {
							listEl.html(html);
						});
					});
				});
			});
		});
	};

	Chats.addRenameHandler = function (roomId, buttonEl, roomName) {
		var modal;

		buttonEl.on('click', function () {
			Benchpress.parse('partials/modals/rename_room', {
				name: roomName || ajaxify.data.roomName,
			}, function (html) {
				translator.translate(html, function (html) {
					modal = bootbox.dialog({
						title: '[[modules:chat.rename-room]]',
						message: html,
						buttons: {
							save: {
								label: '[[global:save]]',
								className: 'btn-primary',
								callback: submit,
							},
						},
					});
				});
			});
		});

		function submit() {
			socket.emit('modules.chats.renameRoom', {
				roomId: roomId,
				newName: modal.find('#roomName').val(),
			}, function (err) {
				if (err) {
					return app.alertError(err.message);
				}
			});
		}
	};

	Chats.addSendHandlers = function (roomId, inputEl, sendEl) {
		inputEl.off('keypress').on('keypress', function (e) {
			if (e.which === 13 && !e.shiftKey) {
				messages.sendMessage(roomId, inputEl);
				return false;
			}
		});

		sendEl.off('click').on('click', function () {
			messages.sendMessage(roomId, inputEl);
			inputEl.focus();
			return false;
		});
	};

	Chats.createAutoComplete = function (element) {
		var data = {
			element: element,
			strategies: [],
			options: {
				zIndex: 20000,
				listPosition: function (position) {
					this.$el.css(this._applyPlacement(position));
					this.$el.css('position', 'absolute');
					return this;
				},
			},
		};

		$(window).trigger('chat:autocomplete:init', data);
		if (data.strategies.length) {
			data.element.textcomplete(data.strategies, data.options);
		}
	};

	Chats.createTagsInput = function (tagEl, data) {
		tagEl.tagsinput({
			confirmKeys: [13, 44],
			trimValue: true,
		});

		if (data.users && data.users.length) {
			data.users.forEach(function (user) {
				tagEl.tagsinput('add', $('<div/>').html(user.username).text());
			});
		}

		tagEl.on('beforeItemAdd', function (event) {
			event.cancel = event.item === app.user.username;
		});

		tagEl.on('itemAdded', function (event) {
			if (event.item === app.user.username) {
				return;
			}
			socket.emit('modules.chats.addUserToRoom', {
				roomId: data.roomId,
				username: event.item,
			}, function (err) {
				if (err) {
					app.alertError(err.message);
					tagEl.tagsinput('remove', event.item, {
						nouser: true,
					});
				}
			});
		});

		tagEl.on('beforeItemRemove', function (event) {
			if (event.options && event.options.nouser) {
				return;
			}

			event.cancel = !data.isOwner || tagEl.tagsinput('items').length < 2;
			if (!data.owner) {
				return app.alertError('[[error:not-allowed]]');
			}

			if (tagEl.tagsinput('items').length < 2) {
				return app.alertError('[[error:cant-remove-last-user]]');
			}
		});

		tagEl.on('itemRemoved', function (event) {
			if (event.options && event.options.nouser) {
				return;
			}
			socket.emit('modules.chats.removeUserFromRoom', {
				roomId: data.roomId,
				username: event.item,
			}, function (err) {
				if (err) {
					return app.alertError(err.message);
				}
			});
		});

		var input = $('.users-tag-container').find('.bootstrap-tagsinput input');

		require(['autocomplete'], function (autocomplete) {
			autocomplete.user(input);
		});
	};

	Chats.leave = function (el) {
		var roomId = el.attr('data-roomid');
		socket.emit('modules.chats.leave', roomId, function (err) {
			if (err) {
				return app.alertError(err.message);
			}
			if (parseInt(roomId, 10) === parseInt(ajaxify.data.roomId, 10)) {
				ajaxify.go('user/' + ajaxify.data.userslug + '/chats');
			} else {
				el.remove();
			}
			require(['chat'], function (chat) {
				var modal = chat.getModal(roomId);
				if (modal.length) {
					chat.close(modal);
				}
			});
		});
	};

	Chats.switchChat = function (roomid) {
		var url = 'user/' + ajaxify.data.userslug + '/chats/' + roomid;
		if (self.fetch) {
			fetch(config.relative_path + '/api/' + url, { credentials: 'include' })
				.then(function (response) {
					if (response.ok) {
						response.json().then(function (payload) {
							app.parseAndTranslate('partials/chats/message-window', payload, function (html) {
								components.get('chat/main-wrapper').html(html);
								html.find('.timeago').timeago();
								Chats.resizeMainWindow();
								ajaxify.data = payload;
								Chats.setActive();
								Chats.addEventListeners();
								messages.scrollToBottom($('.expanded-chat ul'));
								if (history.pushState) {
									history.pushState({
										url: 'user/' + payload.userslug + '/chats/' + payload.roomId,
									}, null, window.location.protocol + '//' + window.location.host + config.relative_path + '/user/' + payload.userslug + '/chats/' + payload.roomId);
								}
							});
						});
					} else {
						console.warn('[search] Received ' + response.status);
					}
				})
				.catch(function (error) {
					console.warn('[search] ' + error.message);
				});
		} else {
			ajaxify.go(url);
		}
	};

	Chats.addGlobalEventListeners = function () {
		$(window).on('resize', Chats.resizeMainWindow);
		$(window).on('mousemove keypress click', function () {
			if (newMessage && ajaxify.data.roomId) {
				socket.emit('modules.chats.markRead', ajaxify.data.roomId);
				newMessage = false;
			}
		});
	};

	Chats.addSocketListeners = function () {
		socket.on('event:chats.receive', function (data) {
			if (parseInt(data.roomId, 10) === parseInt(ajaxify.data.roomId, 10)) {
				newMessage = data.self === 0;
				data.message.self = data.self;

				messages.appendChatMessage($('.expanded-chat .chat-content'), data.message);
			} else if (ajaxify.currentPage.startsWith('chats')) {
				var roomEl = $('[data-roomid=' + data.roomId + ']');

				if (roomEl.length > 0) {
					roomEl.addClass('unread');
				} else {
					var recentEl = components.get('chat/recent');
					Benchpress.parse('partials/chats/recent_room', {
						rooms: {
							roomId: data.roomId,
							lastUser: data.message.fromUser,
							usernames: data.message.fromUser.username,
							unread: true,
						},
					}, function (html) {
						translator.translate(html, function (translated) {
							recentEl.prepend(translated);
						});
					});
				}
			}
		});

		socket.on('event:user_status_change', function (data) {
			app.updateUserStatus($('.chats-list [data-uid="' + data.uid + '"] [component="user/status"]'), data.status);
		});

		messages.onChatMessageEdit();

		socket.on('event:chats.roomRename', function (data) {
			var roomEl = components.get('chat/recent/room', data.roomId);
			var titleEl = roomEl.find('[component="chat/title"]');

			titleEl.text(data.newName);
		});
	};

	Chats.resizeMainWindow = function () {
		var viewportHeight = $(window).height();
		var fromTop = components.get('chat/main-wrapper').offset().top || components.get('chat/nav-wrapper').offset().top;

		$('.chats-full').height(viewportHeight - fromTop);
		Chats.setActive();
	};

	Chats.setActive = function () {
		if (ajaxify.data.roomId) {
			socket.emit('modules.chats.markRead', ajaxify.data.roomId);
			$('.expanded-chat input').focus();
		}
		$('.chats-list li').removeClass('bg-info');
		$('.chats-list li[data-roomid="' + ajaxify.data.roomId + '"]').addClass('bg-info');

		components.get('chat/nav-wrapper').attr('data-loaded', ajaxify.data.roomId ? '1' : '0');
	};


	return Chats;
});

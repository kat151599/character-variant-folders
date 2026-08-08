import {
    characters,
    eventSource,
    event_types,
    getRequestHeaders,
    getThumbnailUrl,
    saveSettingsDebounced,
    selectCharacterById,
} from '../../../../script.js';
import { extension_settings } from '../../../extensions.js';
import { Popup } from '../../../popup.js';
import { groups as sillyTavernGroups, openGroupById } from '../../../group-chats.js';

const MODULE_KEY = 'characterVariantFolders';
const ROOT_ID = 'cvf-root';
const BUTTON_ID = 'cvf-toggle';
const chatCountCache = new Map();

const defaults = {
    enabled: true,
    assignments: {},
    folders: [],
    collapsed: {},
    groupFolders: [],
    groupAssignments: {},
};

function settings() {
    extension_settings[MODULE_KEY] = Object.assign({}, defaults, extension_settings[MODULE_KEY]);
    extension_settings[MODULE_KEY].assignments ??= {};
    extension_settings[MODULE_KEY].folders ??= [];
    extension_settings[MODULE_KEY].collapsed ??= {};
    extension_settings[MODULE_KEY].groupFolders ??= [];
    extension_settings[MODULE_KEY].groupAssignments ??= {};
    return extension_settings[MODULE_KEY];
}

function groupKey(group) {
    return String(group?.id ?? '');
}

function normalizeFolderPath(value) {
    return String(value ?? '').split(/[\\/]+/u).map(part => part.trim()).filter(Boolean).join('/');
}

function memberCharacter(member) {
    return characters.find(character => character.avatar === member || character.name === member || character?.data?.name === member);
}

function groupMembers(group) {
    return (Array.isArray(group?.members) ? group.members : []).map(memberCharacter).filter(Boolean);
}

function groupSignature(group) {
    return (Array.isArray(group?.members) ? group.members : [])
        .map(member => String(member).toLocaleLowerCase()).sort().join('\u0000');
}

function sameMembersFolderName(group) {
    const names = groupMembers(group).map(characterName);
    return names.length ? names.join(' + ') : 'Группы без персонажей';
}

function characterKey(character) {
    return String(character?.avatar || character?.data?.name || character?.name || '');
}

function creatorNotes(character) {
    return String(character?.data?.creator_notes ?? character?.creatorcomment ?? '').trim();
}

function characterName(character) {
    return String(character?.data?.name ?? character?.name ?? 'Без имени').trim();
}

async function getChatCount(character) {
    const key = characterKey(character);
    if (!chatCountCache.has(key)) {
        const request = fetch('/api/characters/chats', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ avatar_url: character.avatar }),
        }).then(async response => {
            if (!response.ok) throw new Error(`Failed to load chat count: ${response.status}`);
            return Object.values(await response.json()).length;
        }).catch(error => {
            chatCountCache.delete(key);
            console.warn('[Character Variant Folders] Could not load chat count', error);
            return null;
        });
        chatCountCache.set(key, request);
    }
    return chatCountCache.get(key);
}

function automaticFolderName(name) {
    return name
        .replace(/\s*(?:[-–—]\s*)?(?:v(?:er(?:sion)?)?\.?\s*\d+(?:\.\d+)*|rev\.?\s*\d+)\s*$/iu, '')
        .replace(/\s*[\[(（][^\])）]{1,40}[\])）]\s*$/u, '')
        .replace(/\s+(?:alt(?:ernate)?|remake|redux|legacy|new|old)\s*$/iu, '')
        .trim();
}

function buildGroups() {
    const config = settings();
    const explicit = new Map(config.folders.map(name => [name, []]));
    const automatic = new Map();
    const loose = [];

    characters.forEach((character, chid) => {
        const item = { character, chid };
        const assigned = config.assignments[characterKey(character)];
        if (assigned && explicit.has(assigned)) {
            explicit.get(assigned).push(item);
            return;
        }

        const base = automaticFolderName(characterName(character));
        if (!automatic.has(base)) automatic.set(base, []);
        automatic.get(base).push(item);
    });

    const groups = [...explicit.entries()]
        .map(([name, items]) => ({ name, items, explicit: true }))
        .filter(group => group.items.length || config.folders.includes(group.name));

    for (const [name, items] of automatic) {
        if (items.length > 1) {
            groups.push({ name, items, explicit: false });
        } else {
            loose.push(...items);
        }
    }

    groups.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
    loose.sort((a, b) => characterName(a.character).localeCompare(characterName(b.character)));
    return { groups, loose };
}

function makeAvatar(item, className = '') {
    const img = document.createElement('img');
    img.className = className;
    img.src = getThumbnailUrl('avatar', item.character.avatar);
    img.alt = characterName(item.character);
    img.loading = 'lazy';
    return img;
}

function folderOptions(selected = '') {
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Без папки (автогруппировка)';
    fragment.append(empty);
    for (const folder of settings().folders) {
        const option = document.createElement('option');
        option.value = folder;
        option.textContent = folder;
        option.selected = folder === selected;
        fragment.append(option);
    }
    return fragment;
}

async function openCharacter(chid) {
    await selectCharacterById(chid);
}

function makeVariant(item, managing) {
    const card = document.createElement('article');
    card.className = 'cvf-variant';
    card.dataset.chid = String(item.chid);
    card.append(makeAvatar(item, 'cvf-variant-avatar'));

    const body = document.createElement('div');
    body.className = 'cvf-variant-body';

    const title = document.createElement('div');
    title.className = 'cvf-variant-title';
    const name = document.createElement('span');
    name.textContent = characterName(item.character);
    title.append(name);

    const version = item.character?.data?.character_version;
    if (version) {
        const badge = document.createElement('span');
        badge.className = 'cvf-version';
        badge.textContent = `v${version}`;
        name.append(' ', badge);
    }

    const chatCount = document.createElement('span');
    chatCount.className = 'cvf-chat-count';
    chatCount.title = 'Количество чатов с персонажем';
    chatCount.innerHTML = '<i class="fa-solid fa-comments"></i> …';
    getChatCount(item.character).then(count => {
        if (count === null || !chatCount.isConnected) return;
        chatCount.lastChild.textContent = ` ${count}`;
    });
    title.append(chatCount);
    body.append(title);

    const notes = document.createElement('div');
    notes.className = creatorNotes(item.character) ? 'cvf-notes' : 'cvf-notes cvf-notes-empty';
    notes.textContent = creatorNotes(item.character) || 'Примечания от создателя отсутствуют';
    body.append(notes);

    if (managing) {
        const select = document.createElement('select');
        select.className = 'text_pole cvf-folder-select';
        const key = characterKey(item.character);
        select.append(folderOptions(settings().assignments[key]));
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('change', () => {
            if (select.value) settings().assignments[key] = select.value;
            else delete settings().assignments[key];
            saveSettingsDebounced();
            render(true);
        });
        body.append(select);
    }

    card.append(body);
    card.addEventListener('click', async () => {
        if (!managing) await openCharacter(item.chid);
    });
    return card;
}

function makeFolder(group, managing) {
    const section = document.createElement('section');
    section.className = 'cvf-folder';
    const collapsed = settings().collapsed[group.name] ?? true;
    section.classList.toggle('cvf-collapsed', collapsed);

    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cvf-folder-header';

    const avatars = document.createElement('span');
    avatars.className = 'cvf-folder-avatars';
    group.items.slice(0, 4).forEach(item => avatars.append(makeAvatar(item)));
    if (!group.items.length) {
        const icon = document.createElement('i');
        icon.className = 'fa-solid fa-folder';
        avatars.append(icon);
    }

    const label = document.createElement('span');
    label.className = 'cvf-folder-label';
    const name = document.createElement('strong');
    name.textContent = group.name;
    const count = document.createElement('small');
    count.textContent = `${group.items.length} вариаций${group.explicit ? '' : ' · автоматически'}`;
    label.append(name, count);

    const chevron = document.createElement('i');
    chevron.className = 'fa-solid fa-chevron-down cvf-chevron';
    header.append(avatars, label, chevron);
    header.addEventListener('click', () => {
        settings().collapsed[group.name] = section.classList.toggle('cvf-collapsed');
        saveSettingsDebounced();
    });
    section.append(header);

    const contents = document.createElement('div');
    contents.className = 'cvf-folder-contents';
    group.items.forEach(item => contents.append(makeVariant(item, managing)));
    if (!group.items.length) {
        const empty = document.createElement('div');
        empty.className = 'cvf-empty';
        empty.textContent = 'Папка пуста';
        contents.append(empty);
    }
    section.append(contents);
    return section;
}

function groupFolderOptions(selected = '') {
    const fragment = document.createDocumentFragment();
    const empty = document.createElement('option');
    empty.value = '';
    empty.textContent = 'Без папки (автогруппировка)';
    fragment.append(empty);
    for (const path of settings().groupFolders) {
        const option = document.createElement('option');
        option.value = path;
        option.textContent = path.split('/').map((part, index) => `${index ? '↳ ' : ''}${part}`).join(' / ');
        option.selected = path === selected;
        fragment.append(option);
    }
    return fragment;
}

function makeGroupCard(group, managing) {
    const card = document.createElement('article');
    card.className = 'cvf-variant cvf-group-card';
    const avatars = document.createElement('div');
    avatars.className = 'cvf-group-card-avatars';
    const members = groupMembers(group);
    members.slice(0, 4).forEach(character => avatars.append(makeAvatar({ character })));
    if (!members.length) avatars.innerHTML = '<i class="fa-solid fa-user-group"></i>';

    const body = document.createElement('div');
    body.className = 'cvf-variant-body';
    const title = document.createElement('div');
    title.className = 'cvf-variant-title';
    const name = document.createElement('span');
    name.textContent = group.name || 'Группа без имени';
    const count = document.createElement('span');
    count.className = 'cvf-chat-count';
    count.innerHTML = `<i class="fa-solid fa-users"></i> ${members.length}`;
    title.append(name, count);
    body.append(title);

    const memberNames = document.createElement('div');
    memberNames.className = 'cvf-notes';
    memberNames.textContent = members.map(characterName).join(', ') || 'Нет доступных персонажей';
    body.append(memberNames);

    if (managing) {
        const select = document.createElement('select');
        select.className = 'text_pole cvf-folder-select';
        const key = groupKey(group);
        select.append(groupFolderOptions(settings().groupAssignments[key]));
        select.addEventListener('click', event => event.stopPropagation());
        select.addEventListener('change', () => {
            if (select.value) settings().groupAssignments[key] = select.value;
            else delete settings().groupAssignments[key];
            saveSettingsDebounced();
            render(true);
        });
        body.append(select);
    }

    card.append(avatars, body);
    card.addEventListener('click', async () => {
        if (!managing) await openGroupById(group.id);
    });
    return card;
}

function makeGroupTree() {
    const root = { name: '', path: '', children: new Map(), groups: [], automatic: false };
    const addFolder = (path, automatic = false) => {
        let node = root;
        let current = '';
        for (const part of normalizeFolderPath(path).split('/').filter(Boolean)) {
            current = current ? `${current}/${part}` : part;
            if (!node.children.has(part)) node.children.set(part, { name: part, path: current, children: new Map(), groups: [], automatic });
            node = node.children.get(part);
            node.automatic &&= automatic;
        }
        return node;
    };
    settings().groupFolders.forEach(path => addFolder(path));

    const bySignature = new Map();
    for (const group of sillyTavernGroups) {
        const assigned = normalizeFolderPath(settings().groupAssignments[groupKey(group)]);
        if (assigned && settings().groupFolders.includes(assigned)) addFolder(assigned).groups.push(group);
        else {
            const signature = groupSignature(group);
            if (!bySignature.has(signature)) bySignature.set(signature, []);
            bySignature.get(signature).push(group);
        }
    }
    for (const sameMembers of bySignature.values()) {
        if (sameMembers.length > 1) addFolder(sameMembersFolderName(sameMembers[0]), true).groups.push(...sameMembers);
        else root.groups.push(...sameMembers);
    }
    return root;
}

function makeGroupFolderNode(node, managing) {
    const section = document.createElement('section');
    section.className = 'cvf-folder cvf-group-folder';
    const collapseKey = `groups/${node.path}`;
    section.classList.toggle('cvf-collapsed', settings().collapsed[collapseKey] ?? true);
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'cvf-folder-header';
    header.innerHTML = `<span class="cvf-folder-avatars"><i class="fa-solid ${node.automatic ? 'fa-users' : 'fa-folder'}"></i></span><span class="cvf-folder-label"><strong></strong><small>${node.groups.length} групп${node.automatic ? ' · одинаковый состав' : ''}</small></span><i class="fa-solid fa-chevron-down cvf-chevron"></i>`;
    header.querySelector('strong').textContent = node.name;
    header.addEventListener('click', () => {
        settings().collapsed[collapseKey] = section.classList.toggle('cvf-collapsed');
        saveSettingsDebounced();
    });
    const contents = document.createElement('div');
    contents.className = 'cvf-folder-contents';
    [...node.children.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(child => contents.append(makeGroupFolderNode(child, managing)));
    node.groups.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(group => contents.append(makeGroupCard(group, managing)));
    if (managing && !node.automatic) {
        const add = document.createElement('button');
        add.type = 'button';
        add.className = 'menu_button cvf-add-subfolder';
        add.innerHTML = '<i class="fa-solid fa-folder-plus"></i> Добавить подпапку';
        add.addEventListener('click', event => { event.stopPropagation(); createGroupFolder(node.path); });
        contents.append(add);
    }
    section.append(header, contents);
    return section;
}

function makeGroupsSection(managing) {
    const section = document.createElement('section');
    section.className = 'cvf-groups-section';
    const heading = document.createElement('div');
    heading.className = 'cvf-section-heading';
    heading.innerHTML = '<strong><i class="fa-solid fa-user-group"></i> Группы</strong>';
    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button fa-solid fa-folder-plus';
    add.title = 'Создать папку для групп';
    add.addEventListener('click', () => createGroupFolder(''));
    heading.append(add);
    section.append(heading);
    const tree = makeGroupTree();
    [...tree.children.values()].sort((a, b) => a.name.localeCompare(b.name)).forEach(node => section.append(makeGroupFolderNode(node, managing)));
    tree.groups.sort((a, b) => String(a.name).localeCompare(String(b.name))).forEach(group => section.append(makeGroupCard(group, managing)));
    if (!sillyTavernGroups.length) {
        const empty = document.createElement('div');
        empty.className = 'cvf-empty';
        empty.textContent = 'Группы не найдены';
        section.append(empty);
    }
    return section;
}

async function createGroupFolder(parentPath = '') {
    const value = await Popup.show.input('Новая папка групп', parentPath ? `Подпапка в «${parentPath}»:` : 'Название папки (можно указать путь через /):', '');
    const child = normalizeFolderPath(value);
    if (!child) return;
    const path = normalizeFolderPath(parentPath ? `${parentPath}/${child}` : child);
    const paths = path.split('/').map((_, index, parts) => parts.slice(0, index + 1).join('/'));
    for (const item of paths) if (!settings().groupFolders.some(x => x.toLocaleLowerCase() === item.toLocaleLowerCase())) settings().groupFolders.push(item);
    settings().groupFolders.sort((a, b) => a.localeCompare(b));
    saveSettingsDebounced();
    render(true);
}

async function createFolder() {
    const value = await Popup.show.input('Новая папка персонажа', 'Введите название папки для вариаций:', '');
    const name = typeof value === 'string' ? value.trim() : '';
    if (!name) return;
    if (settings().folders.some(x => x.toLocaleLowerCase() === name.toLocaleLowerCase())) {
        toastr.warning('Папка с таким названием уже существует.');
        return;
    }
    settings().folders.push(name);
    settings().folders.sort((a, b) => a.localeCompare(b));
    saveSettingsDebounced();
    render(true);
}

function makeToolbar(managing, setManaging) {
    const toolbar = document.createElement('div');
    toolbar.className = 'cvf-toolbar';

    const title = document.createElement('strong');
    title.textContent = 'Папки персонажей';

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'text_pole cvf-search';
    search.placeholder = 'Поиск по папкам, именам и заметкам…';
    search.addEventListener('input', () => applySearch(search.value));

    const manage = document.createElement('button');
    manage.type = 'button';
    manage.className = `menu_button fa-solid ${managing ? 'fa-check' : 'fa-folder-tree'}`;
    manage.title = managing ? 'Завершить сортировку' : 'Распределить персонажей по папкам';
    manage.addEventListener('click', () => setManaging(!managing));

    const add = document.createElement('button');
    add.type = 'button';
    add.className = 'menu_button fa-solid fa-folder-plus';
    add.title = 'Создать папку';
    add.addEventListener('click', createFolder);
    toolbar.append(title, search, manage, add);
    return toolbar;
}

function applySearch(query) {
    const normalized = query.trim().toLocaleLowerCase();
    document.querySelectorAll(`#${ROOT_ID} .cvf-folder, #${ROOT_ID} .cvf-variant`).forEach(element => {
        const matches = !normalized || element.textContent.toLocaleLowerCase().includes(normalized);
        element.classList.toggle('cvf-search-hidden', !matches);
    });
}

let managing = false;
function render(force = false) {
    const config = settings();
    const root = document.getElementById(ROOT_ID);
    const nativeList = document.getElementById('rm_print_characters_block');
    const pagination = document.getElementById('rm_print_characters_pagination');
    if (!root || !nativeList) return;

    root.hidden = !config.enabled;
    nativeList.classList.toggle('cvf-native-hidden', config.enabled);
    pagination?.classList.toggle('cvf-native-hidden', config.enabled);
    document.getElementById(BUTTON_ID)?.classList.toggle('cvf-active', config.enabled);
    if (!config.enabled && !force) return;

    root.replaceChildren();
    root.append(makeToolbar(managing, value => {
        managing = value;
        render(true);
    }));
    root.append(makeGroupsSection(managing));
    const characterHeading = document.createElement('div');
    characterHeading.className = 'cvf-section-heading';
    characterHeading.innerHTML = '<strong><i class="fa-solid fa-user"></i> Персонажи</strong>';
    root.append(characterHeading);
    const { groups, loose } = buildGroups();
    groups.forEach(group => root.append(makeFolder(group, managing)));
    loose.forEach(item => root.append(makeVariant(item, managing)));

    if (!groups.length && !loose.length) {
        const empty = document.createElement('div');
        empty.className = 'cvf-empty';
        empty.textContent = 'Персонажи не найдены';
        root.append(empty);
    }
}

function toggle() {
    settings().enabled = !settings().enabled;
    saveSettingsDebounced();
    render(true);
}

function refreshChatCounts() {
    chatCountCache.clear();
    render();
}

function mount() {
    if (!document.getElementById(BUTTON_ID)) {
        const button = document.createElement('div');
        button.id = BUTTON_ID;
        button.className = 'menu_button fa-solid fa-folder-tree';
        button.title = 'Папки и вариации персонажей';
        button.addEventListener('click', toggle);
        document.getElementById('rm_buttons_container')?.append(button);
    }

    if (!document.getElementById(ROOT_ID)) {
        const root = document.createElement('div');
        root.id = ROOT_ID;
        root.hidden = true;
        document.getElementById('rm_print_characters_block')?.before(root);
    }
    render(true);
}

export function init() {
    settings();
    mount();
    eventSource.on(event_types.CHARACTER_PAGE_LOADED, () => render());
    eventSource.on(event_types.CHARACTER_EDITED, () => render());
    eventSource.on(event_types.CHARACTER_DELETED, () => render());
    eventSource.on(event_types.GROUP_UPDATED, () => render());
    eventSource.on(event_types.CHAT_CREATED, refreshChatCounts);
    eventSource.on(event_types.CHAT_DELETED, refreshChatCounts);
}

jQuery(() => init());

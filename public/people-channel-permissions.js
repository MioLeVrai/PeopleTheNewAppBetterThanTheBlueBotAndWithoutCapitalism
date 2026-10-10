(() => {
  "use strict";
  async function api(path, options = {}) {
    const response = await fetch(path, { credentials: "same-origin", ...options, headers: { "Content-Type": "application/json" } });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Unable to save permissions.");
    return data;
  }
  async function open(serverId, channel) {
    const base = `/api/servers/${encodeURIComponent(serverId)}`;
    const overlay = document.createElement("div"); overlay.className = "people-channel-dialog-overlay";
    const panel = document.createElement("section"); panel.className = "people-channel-dialog people-channel-permissions";
    panel.setAttribute("role", "dialog"); panel.setAttribute("aria-modal", "true"); panel.setAttribute("aria-label", "Channel Permissions");
    const title = document.createElement("h3"); title.textContent = `Permissions — ${channel.name}`;
    const description = document.createElement("p"); description.textContent = "These rules override general role permissions for this channel. Default uses the role and category permissions.";
    const close = document.createElement("button"); close.type = "button"; close.textContent = "Close";
    const list = document.createElement("div"), editor = document.createElement("div"), status = document.createElement("p"); status.setAttribute("role", "status");
    const add = document.createElement("button"); add.type = "button"; add.textContent = "+"; add.setAttribute("aria-label", "Add role rule");
    const roleSelect = document.createElement("select"); roleSelect.setAttribute("aria-label", "Role"); roleSelect.hidden = true;
    panel.append(title, description, list, add, roleSelect, editor, status, close); overlay.append(panel); document.body.append(overlay);
    let dirty = false, saving = false, selected = null, rules = [], version = 0;
    const leave = () => { if (saving || (dirty && !confirm("Discard unsaved changes?"))) return; version++; overlay.remove(); };
    close.onclick = leave;
    overlay.addEventListener("keydown", event => { if (event.key === "Escape") leave(); });
    close.focus();
    try {
      const result = await api(base + "/roles"); if (!overlay.isConnected) return;
      const me = result.me;
      const allowed = me.owner || me.names.includes("MANAGE_ROLES") || me.names.includes("MANAGE_CHANNELS");
      const editable = role => allowed && (me.owner || role.everyone || Number(role.position) < Number(me.highestRolePosition));
      const roles = result.roles || [];
      for (const role of roles.filter(editable)) roleSelect.append(new Option(role.name, role.id));
      add.disabled = !roleSelect.options.length;
      async function load() {
        const request = ++version;
        const data = await api(base + "/permission-overrides?channelId=" + encodeURIComponent(channel.id));
        if (request !== version || !overlay.isConnected) return;
        rules = data.overrides || []; list.replaceChildren();
        for (const rule of rules) {
          const role = roles.find(role => String(role.id) === String(rule.roleId));
          if (!role) continue;
          const button = document.createElement("button"); button.type = "button"; button.textContent = role.name; button.onclick = () => choose(role); list.append(button);
        }
      }
      function choose(role) {
        if (saving || (dirty && !confirm("Discard unsaved changes?"))) return;
        dirty = false; selected = role; editor.replaceChildren(); status.textContent = "";
        const rule = rules.find(rule => String(rule.roleId) === String(role.id));
        const heading = document.createElement("h4"); heading.textContent = role.name; editor.append(heading);
        for (const def of result.permissions) {
          const row = document.createElement("label"); row.className = "people-role-override-row";
          const text = document.createElement("span"); text.textContent = def.label;
          const select = document.createElement("select"); select.dataset.permission = def.key;
          for (const [value, name] of [["inherit", "Default"], ["allow", "Allow"], ["deny", "Deny"]]) select.append(new Option(name, value));
          select.value = rule?.allow.includes(def.key) ? "allow" : rule?.deny.includes(def.key) ? "deny" : "inherit";
          select.disabled = !editable(role); select.onchange = () => { dirty = true; };
          row.append(text, select); editor.append(row);
        }
        const save = document.createElement("button"); save.type = "button"; save.textContent = "Save Changes"; save.disabled = !editable(role);
        const remove = document.createElement("button"); remove.type = "button"; remove.textContent = "Delete Rule"; remove.disabled = !rule || !editable(role);
        async function submit(deleting) {
          if (saving || !editable(selected)) return;
          saving = true; save.disabled = true; remove.disabled = true; roleSelect.disabled = true; add.disabled = true;
          status.textContent = "Saving...";
          const allow = [], deny = [];
          editor.querySelectorAll("select[data-permission]").forEach(select => { if (select.value === "allow") allow.push(select.dataset.permission); if (select.value === "deny") deny.push(select.dataset.permission); });
          editor.querySelectorAll("select").forEach(select => { select.disabled = true; });
          try {
            await api(`${base}/channels/${encodeURIComponent(channel.id)}/role-overrides/${encodeURIComponent(role.id)}`, { method: deleting ? "DELETE" : "PUT", ...(deleting ? {} : { body: JSON.stringify({ allow, deny }) }) });
            dirty = false; await load(); status.textContent = "Permissions saved.";
          } catch (error) { status.textContent = error.message; }
          finally { saving = false; roleSelect.disabled = false; add.disabled = !roleSelect.options.length; save.disabled = !editable(role); remove.disabled = !editable(role) || !rules.some(rule => String(rule.roleId) === String(role.id)); editor.querySelectorAll("select").forEach(select => { select.disabled = !editable(role); }); }
        }
        save.onclick = () => void submit(false); remove.onclick = () => { if (confirm("Delete this channel rule?")) void submit(true); }; editor.append(save, remove);
      }
      add.onclick = () => { roleSelect.hidden = false; if (roleSelect.value) choose(roles.find(role => String(role.id) === roleSelect.value)); };
      roleSelect.onchange = () => choose(roles.find(role => String(role.id) === roleSelect.value));
      await load();
    } catch (error) { status.textContent = error.message; }
  }
  window.PeopleChannelPermissions = { open };
})();

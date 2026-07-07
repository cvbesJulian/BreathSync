// BreathSync web build shim.
// Provides a minimal `chrome.storage.local` + `chrome.storage.onChanged` (and
// small `runtime`/`tabs` stubs) backed by localStorage so the existing
// extension scripts (popup.js, listen.js, midi-permission.js) run unchanged as
// a standalone web app. Cross-tab sync uses the window `storage` event.
//
// It intentionally does NOT define `chrome.runtime.id`, so popup.js keeps
// `isExtensionRuntime === false` and stays on its in-page audio/widget path.
// It no-ops when a real extension `chrome.storage.local` is present.
(function () {
  var existing =
    typeof window.chrome === "object" && window.chrome ? window.chrome : null;

  if (existing && existing.storage && existing.storage.local) {
    return;
  }

  var api = existing || {};
  try {
    window.chrome = api;
  } catch (error) {
    // Some environments expose a read-only `chrome`; nothing else we can do.
  }

  var listeners = [];

  function parse(raw) {
    if (raw === null || raw === undefined) return undefined;
    try {
      return JSON.parse(raw);
    } catch (error) {
      return raw;
    }
  }

  function notify(changes) {
    if (!changes || !Object.keys(changes).length) return;
    listeners.slice().forEach(function (callback) {
      try {
        callback(changes, "local");
      } catch (error) {
        // Ignore listener failures so one bad listener cannot break others.
      }
    });
  }

  function readInto(result, key, fallback) {
    var raw = null;
    try {
      raw = localStorage.getItem(key);
    } catch (error) {
      raw = null;
    }
    result[key] = raw === null ? fallback : parse(raw);
  }

  var local = {
    get: function (query, callback) {
      var result = {};
      try {
        if (query === null || query === undefined) {
          for (var i = 0; i < localStorage.length; i += 1) {
            var storedKey = localStorage.key(i);
            result[storedKey] = parse(localStorage.getItem(storedKey));
          }
        } else if (typeof query === "string") {
          readInto(result, query, undefined);
        } else if (Array.isArray(query)) {
          query.forEach(function (key) {
            readInto(result, key, undefined);
          });
        } else {
          Object.keys(query).forEach(function (key) {
            readInto(result, key, query[key]);
          });
        }
      } catch (error) {
        // Return whatever was gathered.
      }
      if (typeof callback === "function") callback(result);
      return Promise.resolve(result);
    },

    set: function (values, callback) {
      var changes = {};
      try {
        Object.keys(values || {}).forEach(function (key) {
          var oldRaw = null;
          try {
            oldRaw = localStorage.getItem(key);
          } catch (error) {
            oldRaw = null;
          }
          try {
            localStorage.setItem(key, JSON.stringify(values[key]));
          } catch (error) {
            // Quota or serialization issues are non-fatal for this app.
          }
          changes[key] = {
            oldValue: oldRaw === null ? undefined : parse(oldRaw),
            newValue: values[key]
          };
        });
      } catch (error) {
        // Ignore.
      }
      notify(changes);
      if (typeof callback === "function") callback();
      return Promise.resolve();
    },

    remove: function (keys, callback) {
      var list = Array.isArray(keys) ? keys : [keys];
      var changes = {};
      list.forEach(function (key) {
        var oldRaw = null;
        try {
          oldRaw = localStorage.getItem(key);
        } catch (error) {
          oldRaw = null;
        }
        try {
          localStorage.removeItem(key);
        } catch (error) {
          // Ignore.
        }
        changes[key] = {
          oldValue: oldRaw === null ? undefined : parse(oldRaw),
          newValue: undefined
        };
      });
      notify(changes);
      if (typeof callback === "function") callback();
      return Promise.resolve();
    },

    clear: function (callback) {
      try {
        localStorage.clear();
      } catch (error) {
        // Ignore.
      }
      if (typeof callback === "function") callback();
      return Promise.resolve();
    }
  };

  api.storage = {
    local: local,
    onChanged: {
      addListener: function (callback) {
        if (typeof callback === "function") listeners.push(callback);
      },
      removeListener: function (callback) {
        listeners = listeners.filter(function (entry) {
          return entry !== callback;
        });
      }
    }
  };

  // No `id` on purpose: keeps popup.js on its non-extension in-page path.
  api.runtime = api.runtime || {};
  if (typeof api.runtime.getURL !== "function") {
    api.runtime.getURL = function (path) {
      return path;
    };
  }
  if (typeof api.runtime.sendMessage !== "function") {
    api.runtime.sendMessage = function () {
      return Promise.resolve({ ok: true });
    };
  }
  api.runtime.onMessage = api.runtime.onMessage || {
    addListener: function () {},
    removeListener: function () {}
  };

  api.tabs = api.tabs || {};
  if (typeof api.tabs.create !== "function") {
    api.tabs.create = function (options) {
      var url = options && options.url ? options.url : "";
      try {
        window.open(url, "_blank", "noopener");
      } catch (error) {
        // Popup blockers may prevent this; non-fatal.
      }
      return Promise.resolve({});
    };
  }
  if (typeof api.tabs.query !== "function") {
    api.tabs.query = function () {
      return Promise.resolve([]);
    };
  }
  if (typeof api.tabs.sendMessage !== "function") {
    api.tabs.sendMessage = function () {
      return Promise.resolve();
    };
  }
  if (typeof api.tabs.get !== "function") {
    api.tabs.get = function () {
      return Promise.reject(new Error("chrome.tabs.get unavailable in web build"));
    };
  }

  // Cross-tab propagation: the storage event fires only in OTHER same-origin
  // tabs, so writes in this tab were already delivered synchronously above.
  window.addEventListener("storage", function (event) {
    if (!event || !event.key) return;
    var change = {};
    change[event.key] = {
      oldValue: event.oldValue === null ? undefined : parse(event.oldValue),
      newValue: event.newValue === null ? undefined : parse(event.newValue)
    };
    notify(change);
  });
})();

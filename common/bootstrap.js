// https://wiki.mozilla.org/Extension_Manager:Bootstrapped_Extensions

const NAME = "bootstrap";
const global = this;

const Cc = Components.classes;
const Ci = Components.interfaces;
const Cu = Components.utils;
const Cr = Components.results;

Cu.import("resource://gre/modules/AddonManager.jsm");
Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");

const resourceProto = Services.io.getProtocolHandler("resource")
                              .QueryInterface(Ci.nsIResProtocolHandler);
const categoryManager = Cc["@mozilla.org/categorymanager;1"].getService(Ci.nsICategoryManager);
const manager = Components.manager.QueryInterface(Ci.nsIComponentRegistrar);
const storage = Cc["@mozilla.org/fuel/application;1"].getService(Ci.fuelIApplication).storage;

function reportError(e) {
    dump("dactyl: bootstrap: " + e + "\n" + (e.stack || Error().stack));
    Cu.reportError(e);
}

function httpGet(url) {
    let xmlhttp = Cc["@mozilla.org/xmlextras/xmlhttprequest;1"].createInstance(Ci.nsIXMLHttpRequest);
    xmlhttp.open("GET", url, false);
    xmlhttp.send(null);
    return xmlhttp;
}

function writeFile(file, buf) {
    let fstream = Cc["@mozilla.org/network/file-output-stream;1"].createInstance(Ci.nsIFileOutputStream);
    let stream = Cc["@mozilla.org/intl/converter-output-stream;1"].createInstance(Ci.nsIConverterOutputStream);

    fstream.init(file, 0x02 | 0x08 | 0x20, parseInt("0644", 8), 0);
    stream.init(fstream, "UTF-8", 0, "?");
    stream.writeString(buf);
    stream.close();
    fstream.close();
}

let initialized = false;
let addon = null;
let basePath = null;
let components = {};
let getURI = null;
storage.set("dactyl.bootstrap", this);

function startup(data, reason) {
    dump("dactyl: bootstrap: startup " + reasonToString(reason) + "\n");
    basePath = data.installPath;

    if (!initialized) {
        initialized = true;

        dump("dactyl: bootstrap: init" + " " + data.id + "\n");

        addon = data;
        AddonManager.getAddonByID(addon.id, function (a) { addon = a; });

        // Temporary hack.
        if (basePath.isDirectory() && false && JSMLoader.bump == null)
            JSMLoader.bump = 1;

        if (basePath.isDirectory())
            getURI = function getURI(path) {
                let file = basePath.clone().QueryInterface(Ci.nsILocalFile);
                file.appendRelativePath(path);
                return (Services.io || services.io).newFileURI(file);
            };
        else
            getURI = function getURI(path)
                Services.io.newURI("jar:" + Services.io.newFileURI(basePath).spec + "!/" + path, null, null);
        try {
            init();
        }
        catch (e) {
            dump("dactyl: bootstrap: " + e + "\n" + e.stack);
            Cu.reportError(e);
        }
    }
}

function FactoryProxy(url, classID) {
    this.url = url;
    this.classID = Components.ID(classID);
}
FactoryProxy.prototype = {
    QueryInterface: XPCOMUtils.generateQI(Ci.nsIFactory),
    register: function () {
        dump("dactyl: bootstrap: register: " + this.classID + " " + this.contractID + "\n");

        JSMLoader.registerFactory(this);
    },
    get module() {
        dump("dactyl: bootstrap: create module: " + this.contractID + "\n");

        Object.defineProperty(this, "module", { value: {}, enumerable: true });
        JSMLoader.load(this.url, this.module);
        return this.module;
    },
    createInstance: function (iids) {
        return let (factory = this.module.NSGetFactory(this.classID))
            factory.createInstance.apply(factory, arguments);
    }
}

function init() {
    dump("dactyl: bootstrap: init\n");

    let manifestURI = getURI("chrome.manifest");
    let manifest = httpGet(manifestURI.spec)
            .responseText
            .replace(/^\s*|\s*$|#.*/g, "")
            .replace(/^\s*\n/gm, "");

    function url(path) getURI(path).spec;

    let result = [];

    for each (let line in manifest.split("\n")) {
        let fields = line.split(/\s+/);
        switch(fields[0]) {
        case "#":
            if (fields[1] == "Suffix:")
                var suffix = fields[1];
            break;

        case "category":
            categoryManager.addCategoryEntry(fields[1], fields[2], fields[3], false, true);
            break;
        case "component":
            components[fields[1]] = new FactoryProxy(url(fields[2]), fields[1]);
            break;
        case "contract":
            components[fields[2]].contractID = fields[1];
            break;

        case "resource":
            resourceProto.setSubstitution(fields[1], getURI(fields[2]));
        }
    }

    if (typeof JSMLoader === "undefined")
        Cu.import("resource://dactyl/bootstrap.jsm", global);
    else {
        Cu.import("resource://dactyl/bootstrap.jsm", {}).JSMLoader = JSMLoader;
        JSMLoader.load("resource://dactyl/bootstrap.jsm", global);
    }

    if (suffix)
        JSMLoader.suffix = suffix;

    for each (let component in components)
        component.register();

    Services.obs.notifyObservers(null, "dactyl-rehash", null);
    JSMLoader.load("resource://dactyl/bootstrap.jsm", global);

    require(global, "services");

    let manifestText = result.map(function (line) line.join(" ")).join("\n");

    require(global, "overlay");
}

function shutdown(data, reason) {
    dump("dactyl: bootstrap: shutdown " + reasonToString(reason) + "\n");
    if (reason != APP_SHUTDOWN) {
        if ([ADDON_UPGRADE, ADDON_DOWNGRADE, ADDON_UNINSTALL].indexOf(reason) >= 0)
            services.observer.notifyObservers(null, "dactyl-purge", null);

        services.observer.notifyObservers(null, "dactyl-cleanup", null);
        services.observer.notifyObservers(null, "dactyl-cleanup-modules", null);
    }
}

function reasonToString(reason) {
    for each (let name in ["disable", "downgrade", "enable",
                           "install", "shutdown", "startup",
                           "uninstall", "upgrade"])
        if (reason == global["ADDON_" + name.toUpperCase()] ||
            reason == global["APP_" + name.toUpperCase()])
            return name;
}

function install(data, reason) { dump("dactyl: bootstrap: install " + reasonToString(reason) + "\n"); }
function uninstall(data, reason) { dump("dactyl: bootstrap: uninstall " + reasonToString(reason) + "\n"); }

// vim: set fdm=marker sw=4 ts=4 et:

export class MessageTray {
  constructor() {
    this._sources = [];
  }

  add(source) {
    this._sources.push(source);
  }
}

export const messageTray = new MessageTray();

export default {
  messageTray,
};

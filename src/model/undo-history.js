const clone = (value) => structuredClone(value);

export class UndoHistory {
  constructor(limit = 100) {
    this.limit = limit;
    this.undoStack = [];
    this.redoStack = [];
  }

  record(snapshot) {
    this.undoStack.push(clone(snapshot));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.redoStack.length = 0;
  }

  undo(current) {
    if (!this.undoStack.length) return null;
    this.redoStack.push(clone(current));
    return this.undoStack.pop();
  }

  redo(current) {
    if (!this.redoStack.length) return null;
    this.undoStack.push(clone(current));
    return this.redoStack.pop();
  }
}

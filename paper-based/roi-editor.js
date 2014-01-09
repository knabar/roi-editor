
var ROI_MIN_SIZE = 20;


var loadROIsFromJson = function(shapeCallback) {

    var processShape = function(obj, shape) {
        obj.data.original = shape;

        obj.style.strokeColor = shape.strokeColor;
        obj.style.strokeColor.alpha = shape.strokeAlpha;
        obj.style.strokeWidth = shape.stokeWidth;

        obj.style.fillColor = shape.fillColor;
        obj.style.fillColor.alpha = shape.fillAlpha;

        obj.data.label = shape.textValue;

        shapeCallback(obj);
    };

    var loaders = {
        'Rectangle': function(shape) {
            processShape(new paper.Path.Rectangle(
                shape.x, shape.y, shape.width, shape.height), shape);
        },
        'Ellipse': function(shape) {
            processShape(new paper.Path.Ellipse({
                center: [shape.cx, shape.cy],
                radius: [shape.rx, shape.ry]
            }), shape);
        },
        'Point': function(shape) {
            processShape(new paper.Path.Ellipse({
                center: [shape.cx, shape.cy],
                radius: [10, 10]
            }), shape);
        },
        'Line': function(shape) {
            processShape(new paper.Path.Line(
                [shape.x1, shape.y1],
                [shape.x2, shape.y2]
            ), shape);
        }
    };

    $.getJSON(
        "test.json",
        function(data) {
            for (roi in data) {
                for (idx in data[roi].shapes) {
                    var shape = data[roi].shapes[idx];
                    if (shape.theZ === 0 && shape.theT === 0 &&
                        loaders[shape.type] !== undefined) {
                        loaders[shape.type](shape);
                    }
                }
            }
            paper.view.draw();
        }
    );
};


roiEditor = function(element, roiGroupLoader) {
    paper.setup(element);

    var createTextLabel = function(item, label) {
        var text = new paper.PointText(item.bounds.center);
        text.justification = 'center';
        text.fillColor = 'black';
        text.content = label || item.data.label || '';
        item.data.text = text;
        return text;
    };

    var roiLabels = new paper.Group();
    var roiGroup = new paper.Group();
    roiGroupLoader(function(shape) {
        roiGroup.addChild(shape);
        roiLabels.addChild(createTextLabel(shape));
        shape.data.type = shape.data.original.type;
    });

    var roiStyle = {
        strokeColor: 'black',
        fillColor: 'rgba(255, 0, 0, 0.2)'
    };

    var history = function(undoButton, redoButton) {
        var history = {};
        var undos = [];
        var redos = [];
        var updateButtons = function() {
            var undolabel = undos.length ? undos[undos.length - 1].label : '';
            undoButton.text("Undo " + undolabel).prop("disabled", !undolabel);
            var redolabel = redos.length ? redos[redos.length - 1].label : '';
            redoButton.text("Redo " + redolabel).prop("disabled", !redolabel);
        };
        history.add = function(label, undofunc, redofunc, runredo) {
            undos.push({ 'label': label, 'undo': undofunc, 'redo': redofunc });
            redos = [];
            if (runredo) {
                redofunc();
                paper.view.draw();
            }
            updateButtons();
        };
        var undoRedo = function(fromList, toList, action) {
            if (fromList.length) {
                var funcs = fromList.pop();
                toList.push(funcs);
                funcs[action]();
                updateButtons();
                paper.view.draw();
            }
        };
        history.undo = function() {
            undoRedo(undos, redos, 'undo');
        };
        history.redo = function() {
            undoRedo(redos, undos, 'redo');
        };
        history.cleanupWrapper = function(item, pathMode, func) {
            return function() {
                func();
                item.data.text.position = item.bounds.center;
                selectItem(item, pathMode);
            };
        };
        updateButtons();
        return history;
    }($("#undo"), $("#redo"));

    var modes = ['topLeft', 'topCenter', 'topRight', 'leftCenter', 'rightCenter', 'bottomLeft', 'bottomCenter', 'bottomRight'];
    var resizeOptions = {
        topLeft: ['bottomRight', -1, -1],
        topCenter: ['bottomCenter', 0, -1],
        topRight: ['bottomLeft', 1, -1],
        leftCenter: ['rightCenter', -1, 0],
        rightCenter: ['leftCenter', 1, 0],
        bottomLeft: ['topRight', -1, 1],
        bottomCenter: ['topCenter', 0, 1],
        bottomRight: ['topLeft', 1, 1]
    };
    var selectBox = null;
    var selectedItem = null;
    var selectedHandle = null;
    var lastHit = null;
    var dragging = false;
    var mode = null;

    var moveAndCheckBounds = function(delta) {
        var b = paper.project.activeLayer.bounds.clone();
        delta.x = Math.max(delta.x, paper.view.bounds.width - b.width - b.x);
        delta.y = Math.max(delta.y, paper.view.bounds.height - b.height - b.y);
        delta.x = Math.min(delta.x, paper.view.bounds.x - b.x);
        delta.y = Math.min(delta.y, paper.view.bounds.y - b.y);
        paper.project.activeLayer.translate(delta);
    };

    var handles = function() {
        var handles = new paper.Group({ visible: false });
        handles.pathmode = false;
        handles.create = function(pathmode) {
            handles.hide();
            handles.pathmode = pathmode && selectedItem.segments;
            var symbol = handles.pathmode ? new paper.Path.Rectangle(0, 0, 11, 11) :
                                            new paper.Path.Circle(new paper.Point(0, 0), 6);
            for (var i in (handles.pathmode ? selectedItem.segments : modes)) {
                handles.addChild(symbol.clone());
            }
            handles.style = {
                strokeColor: 'black',
                fillColor: 'white'
            };
        };
        handles.update = function() {
            handles.bringToFront().visible = true;
            for (var i in handles.children) {
                handles.children[i].position = (handles.pathmode ? selectedItem.segments[i].point : selectBox.bounds[modes[i]]);
            }
        };
        handles.getMode = function(point) {
            for (var i in handles.children) {
                if (handles.children[i].hitTest(point, { 'fill': true })) {
                    if (handles.pathmode) {
                        selectedHandle = i;
                        return 'moveNode';
                    } else {
                        return 'resize' + modes[i];
                    }
                }
            }
            return null;
        };
        handles.hide = function() {
            handles.visible = false;
            handles.removeChildren();
        };
        return handles;
    }();

    var selectItem = function(item, forceMode) {
        var pathmode = (forceMode !== undefined) ? forceMode :
            (selectedItem == item) && !handles.pathmode; // switch modes when re-selecting the same item
        if (selectBox) {
            selectBox.remove();
        }
        selectedItem = item;
        if (item) {
            selectBox = new paper.Path.Rectangle(item.strokeBounds);
            selectBox.style.strokeColor = 'yellow';
            if (item.data.type != 'Point') { // no handles for points
                handles.create(pathmode);
                handles.update();
            } else {
                handles.hide();
            }
        } else {
            handles.visible = false;
        }
    };

    var undoData = null;
    var defaultTool = new paper.Tool({
        'onMouseDrag': function(event) {
            dragging = true;
            if (mode == 'pan') {
                moveAndCheckBounds(event.delta.clone());
            } else {
                if (mode == 'dragShape') {
                    selectedItem.position = selectedItem.position.add(event.delta);
                    selectBox.position = selectedItem.position;
                } else if (mode.indexOf('resize') === 0) {
                    var ro = resizeOptions[mode.substring(6)];
                    var b = selectedItem.bounds;
                    var nw = Math.max(b.width + event.delta.x * ro[1], ROI_MIN_SIZE);
                    var nh = Math.max(b.height + event.delta.y * ro[2], ROI_MIN_SIZE);
                    selectedItem.scale(nw / b.width, nh / b.height, selectedItem.bounds[ro[0]]);
                    selectBox.scale(nw / b.width, nh / b.height, selectBox.bounds[ro[0]]);
                } else if (mode == 'moveNode') {
                    selectedItem.segments[selectedHandle].point = selectedItem.segments[selectedHandle].point.add(event.delta);
                    selectBox.remove();
                    selectBox = new paper.Path.Rectangle(selectedItem.strokeBounds);
                    selectBox.style.strokeColor = 'yellow';
                }
                selectedItem.data.text.position = selectedItem.bounds.center;
                handles.update();
            }
        },
        'onMouseMove': function(event) {
            var hit = roiGroup.hitTest(event.point, { 'tolerance': 10, 'fill': true, 'stroke': true });
            if (hit && lastHit && hit.item.id == lastHit.item.id) {
                return; // still on same object
            }
            if (lastHit) {
                lastHit.item.style.strokeColor = lastHit.item.data.strokeColor.clone();
            }
            if (hit) {
                if (!hit.item.data.strokeColor) {
                    hit.item.data.strokeColor = hit.item.style.strokeColor.clone(); // save color
                }
                var color = hit.item.data.strokeColor.clone();
                color.hue += 180;
                color.saturation = color.brightness = color.alpha = 1;
                hit.item.style.strokeColor = color;
            }
            lastHit = hit;
        },
        'onMouseDown': function(event) {
            dragging = false;
            if (handles.visible) {
                mode = handles.getMode(event.point);
                if (mode) {
                    if (mode == 'moveNode') {
                        undoData = selectedItem.segments[selectedHandle].point.clone();
                    } else if (mode.indexOf('resize') === 0) {
                        undoData = selectedItem.bounds.clone();
                    }
                    return;
                }
            }
            if (lastHit) {
                selectItem(lastHit.item);
                mode = 'dragShape';
                undoData = selectedItem.position;
            } else {
                mode = 'pan';
            }
        },
        'onMouseUp': function(event) {
            if (dragging) {
                var item = selectedItem;
                var oldPosition, newPosition;
                if (mode == 'dragShape') {
                    oldPosition = undoData;
                    newPosition = item.position;
                    history.add(
                        'move',
                        history.cleanupWrapper(item, false, function() { // undo move
                            item.position = oldPosition;
                        }), history.cleanupWrapper(item, false, function() { // redo move
                            item.position = newPosition;
                        }));
                } else if (mode.indexOf('resize') === 0) {
                    var xratio = undoData.width / item.bounds.width;
                    var yratio = undoData.height / item.bounds.height;
                    var anchor = resizeOptions[mode.substring(6)][0];
                    history.add(
                        'resize',
                        history.cleanupWrapper(item, false, function() { // undo resize
                            selectedItem.scale(xratio, yratio, item.bounds[anchor]);
                        }), history.cleanupWrapper(item, false, function() { // redo resize
                            selectedItem.scale(1 / xratio, 1 / yratio, item.bounds[anchor]);
                        }));
                } else if (mode == 'moveNode') {
                    var handle = selectedHandle;
                    oldPosition = undoData;
                    newPosition = item.segments[handle].point.clone();
                    history.add(
                        'move node',
                        history.cleanupWrapper(item, true, function() { // undo move node
                            item.segments[handle].point = oldPosition;
                        }), history.cleanupWrapper(item, true, function() { // redo move node
                            item.segments[handle].point = newPosition;
                        }));
                }
            } else if (!lastHit) {
                selectItem(null);
            }
        }
    });

    var addRoiTool = new paper.Tool({
        'onMouseDrag': function(event) {
            dragging = true;
            var item = new addRoiTool.createItem(event);
            item.style = roiStyle;
            item.removeOnDrag();
            item.removeOnUp();
        },
        'onMouseDown': function(event) {
            selectItem(null);
            dragging = false;
        },
        'onMouseUp': function(event) {
            if (dragging) {
                var item = addRoiTool.createItem(event);
                item.style = roiStyle;
                item.data.label = '';
                history.add(
                    'create',
                    function() { // undo create
                            item.remove();
                            selectItem(null);
                        }, function() { // redo create
                            roiGroup.addChild(item);
                            roiLabels.addChild(createTextLabel(item));
                            selectItem(item);
                        }, true);
                defaultTool.activate();
            }
        }
    });
    addRoiTool.activateWith = function(createItemFunc) {
        addRoiTool.createItem = createItemFunc;
        addRoiTool.activate();
    };

    var addPointRoiTool = new paper.Tool({
        'onMouseUp': function(event) {
            var point = new paper.Path.Ellipse({
                center: event.point,
                radius: [10, 10]
            });
            point.style = roiStyle;
            point.data.type = 'Point';
            point.data.label = '';
            history.add(
                'create',
                function() { // undo create
                        point.remove();
                        selectItem(null);
                    }, function() { // redo create
                        roiGroup.addChild(point);
                        roiLabels.addChild(createTextLabel(point));
                        selectItem(point);
                    }, true);
            defaultTool.activate();
        }
    });

    var zoom = function(level, x, y, delta) {
        if (!level && delta < 0) {
            level = paper.view.zoom * 1.1;
        } else if (!level && delta > 0) {
            level = paper.view.zoom / 1.1;
        }
        if (level) {
            var before = paper.view.viewToProject(x, y); // get coordinates under mouse before and after zoom...
            paper.view.zoom = level;
            moveAndCheckBounds(paper.view.viewToProject(x, y).subtract(before)); // ...then scroll to keep the point under the mouse
            paper.view.draw();
            $("#zoom-tool").val(parseInt(level * 100, 10));
        }
    };


    paper.view.element.addEventListener('mousewheel', function(ev) {
        zoom(undefined, ev.pageX, ev.pageY, -ev.wheelDelta);
    }, false);
    paper.view.element.addEventListener('DOMMouseScroll', function(ev) {
        zoom(undefined, ev.pageX, ev.pageY, ev.detail);
    }, false);

    $("#toggle-rois").click(function() {
        roiGroup.visible = !roiGroup.visible;
        roiLabels.visible = roiGroup.visible;
        selectItem(null);
        paper.view.draw(); // must draw immediately to avoid visual delay
    });

    $("#edit-roi-label").click(function() {
        if (selectedItem) {
            var newLabel = prompt('Label:', selectedItem.data.label);
            if (newLabel !== null) {
                var item = selectedItem;
                var oldLabel = item.data.label;
                history.add(
                    "rename",
                    function() { // undo rename
                        item.data.label = item.data.text.content = oldLabel;
                    }, function() { // redo rename
                        item.data.label = item.data.text.content = newLabel;
                    }, true);
            }
        }
    });

    $("#delete-roi").click(function() {
        if (selectedItem) {
            var item = selectedItem;
            history.add(
                "delete",
                function() { // undo delete
                    roiGroup.addChild(item);
                    roiLabels.addChild(item.data.text);
                    selectItem(item);
                }, function() { // redo delete
                    item.remove();
                    item.data.text.remove();
                    selectItem(null);
                }, true);
        }
    });

    $("#edit-roi").click(function() {
        defaultTool.activate();
    });

    $("#add-rectangle-roi").click(function() {
        addRoiTool.activateWith(function(event) {
            var shape = new paper.Path.Rectangle(event.downPoint, event.point);
            shape.data.type = 'Rectangle';
            return shape;
        });
    });

    $("#add-ellipse-roi").click(function() {
        addRoiTool.activateWith(function(event) {
            var shape = new paper.Path.Ellipse(event.downPoint, event.point);
            shape.data.type = 'Ellipse';
            return shape;
        });
    });

    $("#add-point-roi").click(function() {
        addPointRoiTool.activate();
    });

    $("#undo").click(function() {
        history.undo();
    });

    $("#redo").click(function() {
        history.redo();
    });

    $("#zoom-tool").on('change', function(event) {
        zoom(parseFloat(this.value, 10) / 100);
    });

    defaultTool.activate();
};

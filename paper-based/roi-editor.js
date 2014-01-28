
var ROI_MIN_SIZE = 20;


roiEditor = function(element, jsonUrl, theZ, theT) {
    paper.setup(element);

    var all_data = null;

    var addUpdater = function(shape) {
        var updateCommonPropertiesFunc = function(updateSpecificPropertiesFunc) {
            return function() {
                shape.data.original.textValue = shape.data.text ? shape.data.text.content : "";
                updateSpecificPropertiesFunc(shape.bounds);
            };
        };
        var updaters = {
            'Rectangle': function(bounds) {
                shape.data.original.x = bounds.x;
                shape.data.original.y = bounds.y;
                shape.data.original.width = bounds.width;
                shape.data.original.height = bounds.height;
            },
            'Ellipse': function(bounds) {
                shape.data.original.cx = bounds.center.x;
                shape.data.original.cy = bounds.center.y;
                shape.data.original.rx = bounds.width / 2;
                shape.data.original.ry = bounds.height / 2;
            },
            'Point': function(bounds) {
                shape.data.original.cx = bounds.center.x;
                shape.data.original.cy = bounds.center.y;
            },
            'Line': function(bounds) {
                shape.data.original.x1 = shape.firstSegment.point.x;
                shape.data.original.y1 = shape.firstSegment.point.y;
                shape.data.original.x2 = shape.lastSegment.point.x;
                shape.data.original.y2 = shape.lastSegment.point.y;
            },
            'Polygon': function(bounds) {
                var path = "";
                for (var idx in shape.segments) {
                    path += (path ? " L " : "M ") + shape.segments[idx].point.x + " " + shape.segments[idx].point.y;
                }
                shape.data.original.points = path + " z";
            },
            'Label': function(bounds) {
                shape.data.original.x = bounds.center.x;
                shape.data.original.y = bounds.center.y;
            }
        };
        shape.data.update = updateCommonPropertiesFunc(updaters[shape.data.original.type]);
    };

    var saveROIsToJson = function(shapes) {
        // save all_data, except for removed shapes
        data = JSON.parse(JSON.stringify(all_data)); // full clone
        for (var idx = data.length - 1; idx >= 0; idx--) {
            for (var shape = data[idx].shapes.length - 1; shape >= 0; shape--) {
                if (data[idx].shapes[shape].deleted) {
                    data[idx].shapes.splice(shape, 1);
                }
            }
            if (data[idx].shapes.length == 0) {
                data.splice(idx, 1);
            }
        }
        return JSON.stringify(data, null, 4);
    };

    var createTextLabel = function(item, label) {
        var text = new paper.PointText(item.bounds.center);
        text.justification = 'center';
        text.fillColor = 'black';
        text.content = label || item.data.original.textValue || '';
        item.data.text = text;
        return text;
    };

    var roiLabels = new paper.Group();
    var roiGroup = new paper.Group();

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
        history.clear = function() {
            undos = [];
            redos = [];
            updateButtons();
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
            handles.pathmode = (selectedItem.data.original.type == 'Line') || (pathmode && selectedItem.data.original.type == 'Polygon');
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
            if (item.data.original.type != 'Point') { // no handles for points
                handles.create(pathmode);
                handles.update();
            } else {
                handles.hide();
            }
        } else {
            handles.visible = false;
        }
    };

    var loadRois = function() {

        var processShape = function(obj, shape, groupId) {
            obj.style.strokeColor = shape.strokeColor;
            obj.style.strokeColor.alpha = shape.strokeAlpha;
            obj.style.strokeWidth = shape.stokeWidth;

            obj.style.fillColor = shape.fillColor;
            obj.style.fillColor.alpha = shape.fillAlpha;

            addUpdater(obj);
            roiGroup.addChild(obj);
            if (obj.type != 'point-text') {
                roiLabels.addChild(createTextLabel(obj));
            }
        };

        var loaders = {
            'Rectangle': function(shape) {
                return new paper.Path.Rectangle(shape.x, shape.y, shape.width, shape.height);
            },
            'Ellipse': function(shape) {
                return new paper.Path.Ellipse({
                    center: [shape.cx, shape.cy],
                    radius: [shape.rx, shape.ry]
                });
            },
            'Point': function(shape) {
                return new paper.Path.Ellipse({
                    center: [shape.cx, shape.cy],
                    radius: [10, 10]
                });
            },
            'Line': function(shape) {
                return new paper.Path.Line([shape.x1, shape.y1], [shape.x2, shape.y2]);
            },
            'Polygon': function(shape) {
                var polygon = new paper.Path();
                polygon.closed = true;
                var points = shape.points.split(" ");
                for (var p = 1; p < points.length; p += 3) {
                    polygon.add(new paper.Point(parseInt(points[p], 10), parseInt(points[p + 1], 10)));
                }
                return polygon;
            },
            'Label': function(shape) {
                var text = new paper.PointText(shape.x, shape.y);
                text.content = shape.textValue;
                text.justification = 'center';
                text.data.text = text; // to make changing label work on object itself
                return text;
            }
        };

        var createShapes = function() {
            selectItem(null);
            history.clear();
            roiLabels.remove();
            roiGroup.remove();
            roiLabels = new paper.Group();
            roiGroup = new paper.Group();
            for (roi in all_data) {
                for (idx in all_data[roi].shapes) {
                    var shape = all_data[roi].shapes[idx];
                    if (shape.theZ === theZ && shape.theT === theT &&
                        loaders[shape.type] !== undefined) {
                        obj = loaders[shape.type](shape);
                        // keep references to original data
                        obj.data.original = shape;
                        obj.data.group = all_data[roi];
                        processShape(obj, shape);
                    }
                }
            }
            paper.view.draw();
        };

        if (!all_data) {
            $.getJSON(
                jsonUrl,
                function(data) {
                    all_data = data;
                    createShapes();
                }
            );
        } else {
            createShapes();
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
                    item.data.update();
                    history.add(
                        'move',
                        history.cleanupWrapper(item, false, function() { // undo move
                            item.position = oldPosition;
                            item.data.update();
                        }), history.cleanupWrapper(item, false, function() { // redo move
                            item.position = newPosition;
                            item.data.update();
                        }));
                } else if (mode.indexOf('resize') === 0) {
                    var xratio = undoData.width / item.bounds.width;
                    var yratio = undoData.height / item.bounds.height;
                    var anchor = resizeOptions[mode.substring(6)][0];
                    item.data.update();
                    history.add(
                        'resize',
                        history.cleanupWrapper(item, false, function() { // undo resize
                            item.scale(xratio, yratio, item.bounds[anchor]);
                            item.data.update();
                        }), history.cleanupWrapper(item, false, function() { // redo resize
                            item.scale(1 / xratio, 1 / yratio, item.bounds[anchor]);
                            item.data.update();
                        }));
                } else if (mode == 'moveNode') {
                    var handle = selectedHandle;
                    oldPosition = undoData;
                    newPosition = item.segments[handle].point.clone();
                    item.data.update();
                    history.add(
                        'move node',
                        history.cleanupWrapper(item, true, function() { // undo move node
                            item.segments[handle].point = oldPosition;
                            item.data.update();
                        }), history.cleanupWrapper(item, true, function() { // redo move node
                            item.segments[handle].point = newPosition;
                            item.data.update();
                        }));
                }
            } else if (!lastHit) {
                selectItem(null);
            }
        }
    });

    var initializeRoi = function(roi, type, temporary) {
        roi.data.original = {
            "fontStyle": "Normal",
            "fillAlpha": 0.25,
            "fontFamily": "sans-serif",
            "strokeAlpha": 0.765625,
            "transform": "none",
            "strokeWidth": 1,
            "fontSize": 12,
            "textValue": "",
            "strokeColor": "#c4c4c4",
            "fillColor": "#000000",
            "type": type,
            "theZ": theZ,
            "theT": theT
        };
        roi.strokeColor = roi.data.original.strokeColor;
        roi.strokeColor.alpha = roi.data.original.strokeAlpha;
        roi.strokeWidth = roi.data.original.strokeWidth;
        roi.fillColor = roi.data.original.fillColor;
        roi.fillColor.alpha = roi.data.original.fillAlpha;
        addUpdater(roi);
        roi.data.update();
        if (!temporary) {
            roi.data.group = {
                "shapes": [roi.data.original],
                "id": null
            };
            all_data.push(roi.data.group);
        }
        return roi;
    };

    var addRoiTool = new paper.Tool({
        'onMouseDrag': function(event) {
            dragging = true;
            var args = new addRoiTool.createItem(event);
            args.push(true);
            initializeRoi.apply(this, args).removeOnDrag().removeOnUp();
        },
        'onMouseDown': function(event) {
            selectItem(null);
            dragging = false;
        },
        'onMouseUp': function(event) {
            if (dragging) {
                var item = initializeRoi.apply(this, addRoiTool.createItem(event));
                history.add(
                    'create',
                    function() { // undo create
                            item.remove();
                            selectItem(null);
                            item.data.original.deleted = true;
                        }, function() { // redo create
                            roiGroup.addChild(item);
                            roiLabels.addChild(createTextLabel(item));
                            selectItem(item);
                            delete item.data.original.deleted;
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
            initializeRoi(point, 'Point');
            history.add(
                'create',
                function() { // undo create
                        point.remove();
                        selectItem(null);
                        point.data.original.deleted = true;
                    }, function() { // redo create
                        roiGroup.addChild(point);
                        roiLabels.addChild(createTextLabel(point));
                        selectItem(point);
                        delete point.data.original.deleted;
                    }, true);
            defaultTool.activate();
        }
    });

    var addTextRoiTool = new paper.Tool({
        'onMouseUp': function(event) {
            var newLabel = prompt('Label:', '');
            if (newLabel) {
                var text = new paper.PointText(event.point);
                text.content = newLabel;
                text.justification = 'center';
                text.data.text = text; // to make changing label work on object itself
                initializeRoi(text, 'Label');
                history.add(
                    'create',
                    function() { // undo create
                            text.remove();
                            selectItem(null);
                            text.data.original.deleted = true;
                        }, function() { // redo create
                            roiGroup.addChild(text);
                            selectItem(text);
                            delete text.data.original.deleted;
                        }, true);
                defaultTool.activate();
            }
        }
    });

    var addPolygonRoiTool = new paper.Tool({
        'onMouseMove': function(event) {
            if (addPolygonRoiTool.current) {
                var item = new paper.Path.Line(addPolygonRoiTool.current.lastSegment.point, event.point);
                item.strokeColor = 'red';
                item.removeOnMove();
                item = new paper.Path.Line(event.point, addPolygonRoiTool.current.firstSegment.point);
                item.strokeColor = 'red';
                item.removeOnMove();
            }
        },
        'onMouseDown': function(event) {
            if (!addPolygonRoiTool.current) {
                addPolygonRoiTool.current = new paper.Path();
                addPolygonRoiTool.current.closed = true;
                initializeRoi(addPolygonRoiTool.current, 'Polygon');
            }
            addPolygonRoiTool.current.add(event.point);
            addPolygonRoiTool.current.data.update();
            if (addPolygonRoiTool.current.segments.length == 2) {
                var polygon = addPolygonRoiTool.current;
                roiGroup.addChild(polygon);
                roiLabels.addChild(createTextLabel(polygon));
                history.add(
                    'create',
                    function() { // undo create
                        polygon.remove();
                        selectItem(null);
                        polygon.data.original.deleted = true;
                    }, function() { // redo create
                        roiGroup.addChild(polygon);
                        selectItem(polygon);
                        delete polygon.data.original.deleted;
                    });
            }
            if (addPolygonRoiTool.current.segments.length >= 2) {
                addPolygonRoiTool.current.data.text.position = addPolygonRoiTool.current.bounds.center;
            }
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
            var newLabel = prompt('Label:', selectedItem.data.original.textValue);
            if (newLabel !== null && (newLabel !== '' || selectedItem.type != 'point-text')) {
                var item = selectedItem;
                var oldLabel = item.data.original.textValue;
                history.add(
                    "rename",
                    function() { // undo rename
                        item.data.original.textValue = item.data.text.content = oldLabel;
                        item.data.update();
                        selectItem(item);
                    }, function() { // redo rename
                        item.data.original.textValue = item.data.text.content = newLabel;
                        item.data.update();
                        selectItem(item);
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
                    delete item.data.original.deleted;
                }, function() { // redo delete
                    item.remove();
                    item.data.text.remove();
                    selectItem(null);
                    item.data.original.deleted = true; // mark deleted so that save will skip this
                }, true);
        }
    });

    $("#edit-roi").click(function() {
        defaultTool.activate();
    });

    $("#add-rectangle-roi").click(function() {
        addRoiTool.activateWith(function(event) {
            var shape = new paper.Path.Rectangle(event.downPoint, event.point);
            return [shape, 'Rectangle'];
        });
    });

    $("#add-ellipse-roi").click(function() {
        addRoiTool.activateWith(function(event) {
            var shape = new paper.Path.Ellipse(event.downPoint, event.point);
            return [shape, 'Ellipse'];
        });
    });

    $("#add-point-roi").click(function() {
        addPointRoiTool.activate();
    });

    $("#add-line-roi").click(function() {
        addRoiTool.activateWith(function(event) {
            var shape = new paper.Path([event.downPoint, event.point]);
            return [shape, 'Line'];
        })
    });

    $("#add-polygon-roi").click(function() {
        addPolygonRoiTool.current = null;
        addPolygonRoiTool.activate();
    });

    $("#add-text-roi").click(function() {
        addTextRoiTool.activate();
    });

    $("#undo").click(function() {
        history.undo();
    });

    $("#redo").click(function() {
        history.redo();
    });

    $("#save").click(function() {
        var json = saveROIsToJson(roiGroup.children);
        $("#saved-json").text(json);
    });

    $("#zoom-tool").on('change', function(event) {
        zoom(parseFloat(this.value, 10) / 100);
    });

    $("#update-roi-table").click(function() {
        $("#roi-table tbody").empty();
        for (var idx in roiGroup.children) {
            var roi = roiGroup.children[idx];
            $("#roi-table tbody").append("<tr><td>" + roi.data.original.id +
                                         "</td><td>" + roi.data.original.type +
                                         "</td><td>" + roi.data.original.textValue + "</td></tr>");
        }
        console.log(roiGroup.firstChild)
    });

    {
        defaultTool.oldActivate = defaultTool.activate;
        defaultTool.activate = function() {
            defaultTool.oldActivate();
            $("button.tool").removeClass("activeTool");
            $("#edit-roi").addClass("activeTool");
        };
    };

    $("button.tool").click(function() {
        $("button.tool").removeClass("activeTool");
        $(this).addClass("activeTool");
    });

    $("#theZ, #theT").on('change', function() {
        theZ = parseInt($("#theZ").val(), 10);
        theT = parseInt($("#theT").val(), 10);
        loadRois();
    });

    defaultTool.activate();

    loadRois();

};

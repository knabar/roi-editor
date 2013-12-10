roiEditor = function(element, roiGroupLoader) {
    paper.setup(element);

    var roiGroup = roiGroupLoader();
    var roiLabels = new paper.Group();

    var roiStyle = {
        strokeColor: 'black',
        fillColor: 'rgba(255, 0, 0, 0.2)'
    };

    var createTextLabel = function(item, label) {
        var text = new paper.PointText(item.bounds.center);
        text.justification = 'center';
        text.fillColor = 'black';
        text.content = label || item.data.label || '';
        item.data.text = text;
        return text;
    };

    // create text labels for ROIs
    for (var i in roiGroup.children) {
        roiLabels.addChild(createTextLabel(roiGroup.children[i]));
    }

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

    var selectItem = function(item, pathMode) {
        var pathmode = (selectedItem == item) && !handles.pathmode; // switch modes when re-selecting the same item
        if (selectBox) {
            selectBox.remove();
        }
        selectedItem = item;
        if (item) {
            selectBox = new paper.Path.Rectangle(item.strokeBounds);
            selectBox.style.strokeColor = 'yellow';
            handles.create(pathmode);
            handles.update();
        } else {
            handles.visible = false;
        }
    };

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
                if (selectedItem.data.text) {
                    selectedItem.data.text.position = selectedItem.bounds.center;
                }
                handles.update();
            }
        },
        'onMouseMove': function(event) {
            var hit = roiGroup.hitTest(event.point, { 'tolerance': 10, 'fill': true, 'stroke': true });
            if (lastHit) {
                lastHit.item.strokeColor = 'black';
            }
            if (hit) {
                hit.item.strokeColor = 'green';
            }
            lastHit = hit;
        },
        'onMouseDown': function(event) {
            dragging = false;
            if (handles.visible) {
                mode = handles.getMode(event.point);
                if (mode) {
                    return;
                }
            }
            if (lastHit) {
                selectItem(lastHit.item);
                mode = 'dragShape';
            } else {
                mode = 'pan';
            }
        },
        'onMouseUp': function(event) {
            if (!dragging && !lastHit) {
                selectItem(null);
            }
        }
    });

    var newItem = null;
    var addRoiTool = new paper.Tool({
        'onMouseDrag': function(event) {
            dragging = true;
            var item = new paper.Path.Rectangle(event.downPoint, event.point);
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
                var item = new paper.Path.Rectangle(event.downPoint, event.point);
                item.style = roiStyle;
                item.data.label = '';
                roiGroup.addChild(item);
                roiLabels.addChild(createTextLabel(item));
                selectItem(item);
                defaultTool.activate();
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
            var newLabel = prompt('Label:', selectedItem.data.label);
            if (newLabel !== null) {
                selectedItem.data.label = selectedItem.data.text.content = newLabel;
                paper.view.draw();
            }
        }
    });

    $("#delete-roi").click(function() {
        if (selectedItem) {
            selectedItem.remove();
            selectedItem.data.text.remove();
            selectItem(null);
            paper.view.draw();
        }
    });

    $("#edit-roi").click(function() {
        defaultTool.activate();
    });

    $("#add-rectangle-roi").click(function() {
        addRoiTool.activate();
    });

    $("#zoom-tool").on('change', function(event) {
        zoom(parseFloat(this.value, 10) / 100);
    });

    defaultTool.activate();
};

/* @flow */

import React, {Component} from 'react';
import type {Node} from 'react';
import {
    Text,
    View,
    Image,
    Animated,
    FlatList,
    StyleSheet,
    Dimensions,
    PanResponder,
    TouchableOpacity,
    ActivityIndicator,
} from 'react-native';

import Modal from 'react-native-root-modal';

type TouchType = {
    pageX: number,
    pageY: number,
};

type EventType = {
    nativeEvent: {
        touches: Array<TouchType>,
    },
};

type ImageType = {
    source: any,
    width: number,
    height: number,
    title: ?string,
};

type TranslateType = {
    x: number,
    y: number,
};

type GestureState = {
    dx: number,
    dy: number,
    vx: number,
    vy: number,
};

type PropsType = {
    images: Array<ImageType>,
    imageIndex: number,
    isVisible: boolean,
    animation: 'none' | 'fade',
    onClose: () => {},
    renderFooter: () => {},
};

const IMAGE_SPEED_FOR_CLOSE = 1.1;
const SCALE_MAXIMUM = 5;
const HEADER_HEIGHT = 60;
const SCALE_EPSILON = 0.01;
const SCALE_MULTIPLIER = 1.2;
const SCALE_MAX_MULTIPLIER = 3;
const FREEZE_SCROLL_DISTANCE = 15;
const BACKGROUND_OPACITY_MULTIPLIER = 0.003;

const {width: screenWidth, height: screenHeight} = Dimensions.get('window');
const styles = StyleSheet.create({
    container: {
        width: screenWidth,
        height: screenHeight,
    },
    header: {
        position: 'absolute',
        top: 0,
        left: 0,
        zIndex: 100,
        height: HEADER_HEIGHT,
        width: screenWidth,
    },
    imageContainer: {
        width: screenWidth,
        height: screenHeight,
        overflow: 'hidden',
    },
    loading: {
        position: 'absolute',
        top: screenHeight / 2 - 20,
        alignSelf: 'center',
    },
    closeButton: {
        alignSelf: 'flex-end',
    },
    closeButton__text: {
        padding: 25,
        backgroundColor: 'transparent',
        fontSize: 25,
        color: '#FFF',
        textAlign: 'center',
    },
    footer: {
        position: 'absolute',
        bottom: 0,
        left: 0,
        zIndex: 100,
    },
});

const generatePanHandlers = (onStart, onMove, onRelease): any =>
    PanResponder.create({
        onStartShouldSetPanResponder: (): boolean => true,
        onStartShouldSetPanResponderCapture: (): boolean => true,
        onMoveShouldSetPanResponder: (): boolean => true,
        onMoveShouldSetPanResponderCapture: (): boolean => true,
        onPanResponderGrant: onStart,
        onPanResponderMove: onMove,
        onPanResponderRelease: onRelease,
        onPanResponderTerminate: onRelease,
        onPanResponderTerminationRequest: (): void => {},
    });

const getScale = (currentDistance: number, initialDistance: number): number =>
    currentDistance / initialDistance * SCALE_MULTIPLIER;
const pow2abs = (a: number, b: number): number => Math.pow(Math.abs(a - b), 2);

function getItemLayout(data, index): any {
    return {
        length: screenWidth,
        offset: screenWidth * index,
        index,
    };
}

function getDistance(touches: Array<TouchType>): number {
    const [a, b] = touches;

    if (a == null || b == null) {
        return 0;
    }

    return Math.sqrt(pow2abs(a.pageX, b.pageX) + pow2abs(a.pageY, b.pageY));
}

function calculateInitialScale(
    imageWidth: number = 0,
    imageHeight: number = 0
): number {
    const screenRatio = screenHeight / screenWidth;
    const imageRatio = imageHeight / imageWidth;

    if (imageWidth > screenWidth || imageHeight > screenHeight) {
        if (screenRatio > imageRatio) {
            return screenWidth / imageWidth;
        }

        return screenHeight / imageHeight;
    }

    return 1;
}

function calculateInitalTranslate(
    imageWidth: number = 0,
    imageHeight: number = 0
): TranslateType {
    const getTranslate = (axis: string): number => {
        const imageSize = axis === 'x' ? imageWidth : imageHeight;
        const screenSize = axis === 'x' ? screenWidth : screenHeight;

        if (imageWidth >= imageHeight) {
            return (screenSize - imageSize) / 2;
        }

        return screenSize / 2 - imageSize / 2;
    };

    return {
        x: getTranslate('x'),
        y: getTranslate('y'),
    };
}

function fetchImageSize(images: Array<Image> = []) {
    return images.reduce((acc, image, index) => {
        if (
            image.source &&
            image.source.uri &&
            (!image.width || !image.height)
        ) {
            const imageSize = new Promise((resolve, reject) => {
                Image.getSize(
                    image.source.uri,
                    (width, height) =>
                        resolve({
                            width,
                            height,
                            index,
                        }),
                    reject
                );
            });

            acc.push(imageSize);
        }

        return acc;
    }, []);
}

const getInitalParams = ({
    width,
    height,
}: {
    width: number,
    height: number,
}): {
    scale: number,
    translate: TranslateType,
} => ({
    scale: calculateInitialScale(width, height),
    translate: calculateInitalTranslate(width, height),
});

const getImagesWithoutSize = (images: Array<ImageType>) =>
    images.filter(({width, height}) => !width || !height);

const scalesAreEqual = (scaleA: number, scaleB: number): boolean =>
    Math.abs(scaleA - scaleB) < SCALE_EPSILON;

export default class ImageView extends Component<PropsType> {
    constructor(props: PropsType) {
        super(props);

        this.renderCounter = 1;

        // calculate initial scale and translate for images
        this.imageInitialParams = props.images.map(getInitalParams);

        this.state = {
            images: props.images,
            isVisible: props.isVisible,
            imageIndex: props.imageIndex,
            imageScale: 1,
            imageTranslate: {x: 0, y: 0},
            scrollEnabled: true,
            panelsVisible: true,
            isFlatListRerendered: false,
        };

        this.isScrolling = false;
        this.footerHeight = 0;
        this.initialTouches = [];
        this.currentTouchesNum = 0;
        this.doubleTapTimer = null;
        this.modalAnimation = new Animated.Value(0);
        this.modalBackgroundOpacity = new Animated.Value(0);

        this.headerTranslateValue = new Animated.ValueXY();
        this.footerTranslateValue = new Animated.ValueXY();

        this.imageScaleValue = new Animated.Value(this.getInitialScale());
        this.imageTranslateValue = new Animated.ValueXY(
            this.getInitialTranslate()
        );

        this.panResponder = generatePanHandlers(
            (event: EventType, gestureState: GestureState): void =>
                this.onGestureStart(event.nativeEvent, gestureState),
            (event: EventType, gestureState: GestureState): void =>
                this.onGestureMove(event.nativeEvent, gestureState),
            (event: EventType, gestureState: GestureState): void =>
                this.onGestureRelease(event.nativeEvent, gestureState)
        );

        this.onNextImage = this.onNextImage.bind(this);
        this.renderImage = this.renderImage.bind(this);
        this.togglePanels = this.togglePanels.bind(this);
        this.onFlatListRender = this.onFlatListRender.bind(this);
        this.setSizeForImages = this.setSizeForImages.bind(this);

        const imagesWithoutSize = getImagesWithoutSize(props.images);

        if (imagesWithoutSize.length) {
            Promise.all(fetchImageSize(imagesWithoutSize)).then(
                this.setSizeForImages
            );
        }
    }

    componentWillReceiveProps(nextProps: PropsType) {
        const {images, imageIndex, isVisible} = this.state;

        if(images !== nextProps.images){
            this.setState({images: nextProps.images})
        }

        if (
            typeof nextProps.isVisible !== 'undefined' &&
            nextProps.isVisible !== isVisible
        ) {
            this.onNextImagesReceived(nextProps.images, nextProps.imageIndex);

            if (
                images !== nextProps.images ||
                imageIndex !== nextProps.imageIndex
            ) {
                const imagesWithoutSize = getImagesWithoutSize(
                    nextProps.images
                );

                if (imagesWithoutSize.length) {
                    Promise.all(fetchImageSize(imagesWithoutSize)).then(
                        updatedImages =>
                            this.onNextImagesReceived(
                                this.setSizeForImages(updatedImages),
                                nextProps.imageIndex
                            )
                    );
                }
            }

            this.setState({
                isVisible: nextProps.isVisible,
                isFlatListRerendered: false,
            });

            this.modalBackgroundOpacity.setValue(0);

            if (nextProps.isVisible) {
                Animated.timing(this.modalAnimation, {
                    duration: 400,
                    toValue: 1,
                }).start();
            }
        }
    }

    onNextImagesReceived(images: Array<ImageType>, imageIndex: number = 0) {
        this.imageInitialParams = images.map(getInitalParams);
        const {scale, translate} = this.imageInitialParams[imageIndex];

        this.setState({
            imageIndex,
            imageScale: scale,
            imageTranslate: translate,
            isFlatListRerendered: false,
        });

        this.imageScaleValue.setValue(scale);
        this.imageTranslateValue.setValue(translate);
    }

    onFlatListRender(flatList: Node) {
        const {imageIndex, isFlatListRerendered} = this.state;

        if (flatList && !isFlatListRerendered) {
            this.setState({
                isFlatListRerendered: true,
            });

            // Fix for android https://github.com/facebook/react-native/issues/13202
            const nextTick = new Promise(resolve => setTimeout(resolve, 0));
            nextTick.then(() => {
                flatList.scrollToIndex({
                    index: imageIndex,
                    animated: false,
                });
            });
        }
    }

    onNextImage(event: EventType) {
        const {imageIndex} = this.state;
        const {x} = event.nativeEvent.contentOffset || {x: 0};

        const nextImageIndex = Math.round(x / screenWidth);

        this.isScrolling = x % screenWidth > 10;

        if (imageIndex !== nextImageIndex && nextImageIndex >= 0) {
            const nextImageScale = this.getInitialScale(nextImageIndex);
            const nextImageTranslate = this.getInitialTranslate(nextImageIndex);

            this.setState({
                imageIndex: nextImageIndex,
                imageScale: nextImageScale,
                imageTranslate: nextImageTranslate,
            });

            this.imageScaleValue.setValue(nextImageScale);
            this.imageTranslateValue.setValue(nextImageTranslate);
        }
    }

    onGestureStart(event: EventType) {
        this.initialTouches = event.touches;
        this.currentTouchesNum = event.touches.length;
    }

    /**
     * If image is moved from its original position
     * then disable scroll (for ScrollView)
     */
    onGestureMove(event: EventType, gestureState: GestureState) {
        if (this.isScrolling) {
            return;
        }

        if (this.currentTouchesNum === 1 && event.touches.length === 2) {
            this.initialTouches = event.touches;
        }

        const {images, imageIndex, imageScale, imageTranslate} = this.state;
        const {touches} = event;
        const {x, y} = imageTranslate;
        const {dx, dy} = gestureState;
        const imageInitialScale = this.getInitialScale();
        const {height} = images[imageIndex];

        if (imageScale !== imageInitialScale) {
            this.imageTranslateValue.x.setValue(x + dx);
        }

        // Do not allow to move image verticaly untill it fits to the screen
        if (imageScale * height > screenHeight) {
            this.imageTranslateValue.y.setValue(y + dy);
        }

        // if image not scaled and fits to the screen
        if (
            scalesAreEqual(imageScale, imageInitialScale) &&
            height * imageInitialScale < screenHeight
        ) {
            const backgroundOpacity = Math.abs(
                dy * BACKGROUND_OPACITY_MULTIPLIER
            );

            this.imageTranslateValue.y.setValue(y + dy);
            this.modalBackgroundOpacity.setValue(
                backgroundOpacity > 1 ? 1 : backgroundOpacity
            );
        }

        const currentDistance = getDistance(touches);
        const initialDistance = getDistance(this.initialTouches);

        const scrollEnabled = Math.abs(dy) < FREEZE_SCROLL_DISTANCE;
        this.setState({scrollEnabled});

        if (!initialDistance) {
            return;
        }

        if (touches.length < 2) {
            return;
        }

        let nextScale = getScale(currentDistance, initialDistance) * imageScale;

        if (nextScale < imageInitialScale) {
            nextScale = imageInitialScale;
        } else if (nextScale > SCALE_MAXIMUM) {
            nextScale = SCALE_MAXIMUM;
        }

        this.imageScaleValue.setValue(nextScale);
        this.currentTouchesNum = event.touches.length;
    }

    onGestureRelease(event: EventType, gestureState: GestureState) {
        const {imageScale} = this.state;

        let {_value: scale} = this.imageScaleValue;
        const {_value: modalBackgroundOpacity} = this.modalBackgroundOpacity;

        const {dx, dy, vy} = gestureState;
        const imageInitialScale = this.getInitialScale();
        const imageInitialTranslate = this.getInitialTranslate();

        // Position haven't changed, so it just tap
        if (event && !dx && !dy && scalesAreEqual(imageScale, scale)) {
            // Double tap timer is launced, its double tap

            if (this.doubleTapTimer) {
                clearTimeout(this.doubleTapTimer);
                this.doubleTapTimer = null;

                scale = scalesAreEqual(imageInitialScale, scale)
                    ? scale * SCALE_MAX_MULTIPLIER
                    : imageInitialScale;

                Animated.timing(this.imageScaleValue, {
                    toValue: scale,
                    duration: 300,
                }).start();

                this.togglePanels(scale === imageInitialScale);
            } else {
                this.doubleTapTimer = setTimeout(() => {
                    this.togglePanels();
                    this.doubleTapTimer = null;
                }, 200);
            }
        }

        let {x, y} = this.calcultateNextTranslate(dx, dy, scale);
        const scrollEnabled =
            scale === this.getInitialScale() &&
            x === imageInitialTranslate.x &&
            y === imageInitialTranslate.y;
        
        if(Number.isNaN(x)){
            x = imageInitialTranslate.x
        }

        if(Number.isNaN(y)){
            y = imageInitialTranslate.y
        }

        Animated.parallel(
            [
                modalBackgroundOpacity > 0
                    ? Animated.timing(this.modalBackgroundOpacity, {
                          toValue: 0,
                          duration: 100,
                      })
                    : null,
                Animated.timing(this.imageTranslateValue.x, {
                    toValue: x,
                    duration: 100,
                }),
                Animated.timing(this.imageTranslateValue.y, {
                    toValue: y,
                    duration: 100,
                }),
            ].filter(Boolean)
        ).start();

        // Close modal with animation if image not scaled and high vertical gesture speed
        if (
            scale === imageInitialScale &&
            Math.abs(vy) >= IMAGE_SPEED_FOR_CLOSE
        ) {
            Animated.timing(this.imageTranslateValue.y, {
                toValue: y + 400 * vy,
                duration: 150,
            }).start(() => {
                this.close();
            });
        }

        this.setState({
            imageScale: scale,
            imageTranslate: {x, y},
            scrollEnabled,
        });
    }

    onImageLoaded(index: number) {
        const {images} = this.state;

        images[index] = {...images[index], loaded: true};

        this.setState({images});
    }

    setSizeForImages(nextImages: Array<ImageType>): Array<ImageType> {
        if (nextImages.length === 0) {
            return [];
        }

        const {images} = this.state;

        return images.map((image, index) => {
            const nextImageSize = nextImages.find(
                nextImage => nextImage.index === index
            );

            if (nextImageSize) {
                image.width = nextImageSize.width;
                image.height = nextImageSize.height;
            }

            return image;
        });
    }

    getInitialScale(index: number): number {
        const imageIndex = index !== undefined ? index : this.state.imageIndex;

        return this.imageInitialParams[imageIndex].scale;
    }

    getInitialTranslate(index: number): TranslateType {
        const imageIndex = index !== undefined ? index : this.state.imageIndex;

        return this.imageInitialParams[imageIndex].translate;
    }

    getImageStyle(
        image: ImageType,
        index: number
    ): {width: number, height: number, transform: any} {
        const {imageIndex} = this.state;
        const {width, height} = image;

        if (!width || !height) {
            return {opacity: 0};
        }

        // very strange caching, fix it with changing size to 1 pixel
        const traslateValue = new Animated.ValueXY(
            calculateInitalTranslate(width, height + 1)
        );

        const transform =
            index === imageIndex
                ? this.imageTranslateValue.getTranslateTransform()
                : traslateValue.getTranslateTransform();

        const scale =
            index === imageIndex
                ? this.imageScaleValue
                : this.getInitialScale(index);

        transform.push({scale});

        return {width, height, transform};
    }

    calcultateNextTranslate(
        dx: number,
        dy: number,
        scale: number
    ): {x: number, y: number} {
        const {images, imageIndex, imageTranslate} = this.state;
        const {x, y} = imageTranslate;
        const {width, height} = images[imageIndex];
        const {imageInitialScale} = this.getInitialScale();

        const getTranslate = (axis: string): number => {
            const imageSize = axis === 'x' ? width : height;
            const screenSize = axis === 'x' ? screenWidth : screenHeight;
            const leftLimit = (scale * imageSize - imageSize) / 2;
            const rightLimit = screenSize - imageSize - leftLimit;

            let nextTranslate = axis === 'x' ? x + dx : y + dy;

            // Less than the screen
            if (screenSize > scale * imageSize) {
                if (width >= height) {
                    nextTranslate = (screenSize - imageSize) / 2;
                } else {
                    nextTranslate =
                        screenSize / 2 -
                        imageSize * (scale / imageInitialScale) / 2;
                }

                return nextTranslate;
            }

            if (nextTranslate > leftLimit) {
                nextTranslate = leftLimit;
            }

            if (nextTranslate < rightLimit) {
                nextTranslate = rightLimit;
            }

            return nextTranslate;
        };

        return {x: getTranslate('x'), y: getTranslate('y')};
    }

    close() {
        this.setState({isVisible: false});

        if (typeof this.props.onClose === 'function') {
            this.props.onClose();
        }
    }

    togglePanels(isVisible: boolean) {
        const panelsVisible =
            typeof isVisible !== 'undefined'
                ? isVisible
                : !this.state.panelsVisible;
        // toggle footer and header
        this.setState({panelsVisible});

        Animated.timing(this.headerTranslateValue.y, {
            toValue: !panelsVisible ? -HEADER_HEIGHT : 0,
            duration: 200,
            useNativeDriver: true,
        }).start();

        if (this.footerHeight > 0) {
            Animated.timing(this.footerTranslateValue.y, {
                toValue: !panelsVisible ? this.footerHeight : 0,
                duration: 200,
                useNativeDriver: true,
            }).start();
        }
    }

    renderImage({item: image, index}): Node {
        const loaded = image.loaded && image.width && image.height;

        return (
            <View
                style={styles.imageContainer}
                onStartShouldSetResponder={(): boolean => true}
            >
                <Animated.Image
                    resizeMode="cover"
                    source={image.source}
                    style={this.getImageStyle(image, index)}
                    onLoad={(): void => this.onImageLoaded(index)}
                    {...this.panResponder.panHandlers}
                />
                {!loaded && <ActivityIndicator style={styles.loading} />}
            </View>
        );
    }

    render(): Node {
        const {animation, renderFooter} = this.props;
        const {images, imageIndex, isVisible, scrollEnabled} = this.state;

        const headerTranslate = this.headerTranslateValue.getTranslateTransform();
        const footerTranslate = this.footerTranslateValue.getTranslateTransform();
        const backgroundColor = this.modalBackgroundOpacity.interpolate({
            inputRange: [0, 1],
            outputRange: ['rgba(0, 0, 0, 0.9)', 'rgba(0, 0, 0, 0.2)'],
        });

        return (
            <Animated.Modal
                visible={isVisible}
                style={[
                    styles.modal,
                    animation === 'fade' && {opacity: this.modalAnimation},
                    {backgroundColor},
                ]}
            >
                <Animated.View
                    style={[styles.header, {transform: headerTranslate}]}
                >
                    <TouchableOpacity
                        style={styles.closeButton}
                        onPress={() => {
                            this.close();
                        }}
                    >
                        <Text style={styles.closeButton__text}>×</Text>
                    </TouchableOpacity>
                </Animated.View>
                <FlatList
                    horizontal
                    pagingEnabled
                    data={images}
                    scrollEnabled={scrollEnabled}
                    scrollEventThrottle={16}
                    style={styles.container}
                    ref={this.onFlatListRender}
                    renderSeparator={() => null}
                    keyExtractor={(image: ImageType): string =>
                        images.indexOf(image).toString()
                    }
                    onScroll={this.onNextImage}
                    renderItem={this.renderImage}
                    getItemLayout={getItemLayout}
                />
                {renderFooter && (
                    <Animated.View
                        style={[styles.footer, {transform: footerTranslate}]}
                        onLayout={event => {
                            this.footerHeight = event.nativeEvent.layout.height;
                        }}
                    >
                        {typeof renderFooter === 'function' &&
                            renderFooter(images[imageIndex])}
                    </Animated.View>
                )}
            </Animated.Modal>
        );
    }
}

ImageView.defaultProps = {
    images: [],
    imageIndex: 0,
};

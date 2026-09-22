"""
ML Service for Duplicate Product Detection
Layer 2: CNN Feature Extraction (MobileNetV2)
Layer 3: SIFT Keypoint Verification
"""

import os
import io
import cv2
import numpy as np
import urllib.request
import tensorflow as tf
from tensorflow.keras.applications import MobileNetV2
from tensorflow.keras.applications.mobilenet_v2 import preprocess_input
from tensorflow.keras.layers import GlobalAveragePooling2D
from tensorflow.keras.models import Model
from flask import Flask, request, jsonify
import warnings

warnings.filterwarnings('ignore')
tf.get_logger().setLevel('ERROR')

app = Flask(__name__)

# Global model instance
cnn_model = None
feature_extractor = None


def initialize_model():
    """Initialize MobileNetV2 model for feature extraction"""
    global cnn_model, feature_extractor
    
    # Use MobileNetV2 - much faster than ResNet50
    base_model = MobileNetV2(
        weights='imagenet',
        include_top=False,
        input_shape=(224, 224, 3)
    )
    
    # Add global average pooling to get 1280D feature vector
    x = base_model.output
    x = GlobalAveragePooling2D()(x)
    feature_extractor = Model(inputs=base_model.input, outputs=x)
    
    # Warm up the model
    dummy_input = np.zeros((1, 224, 224, 3), dtype=np.float32)
    _ = feature_extractor.predict(dummy_input, verbose=0)
    
    print("[ML Service] MobileNetV2 model initialized successfully")


def download_image(url, timeout=5):
    """Download image from URL with timeout"""
    try:
        req = urllib.request.Request(
            url,
            headers={'User-Agent': 'Mozilla/5.0 (compatible; ML-Service/1.0)'}
        )
        with urllib.request.urlopen(req, timeout=timeout) as response:
            image_data = response.read()
        
        # Convert to numpy array
        nparr = np.frombuffer(image_data, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        
        if img is None:
            raise ValueError("Failed to decode image")
        
        return img
    except Exception as e:
        raise Exception(f"Failed to download image: {str(e)}")


def preprocess_for_cnn(img):
    """Preprocess image for MobileNetV2"""
    # Resize to 224x224
    img = cv2.resize(img, (224, 224))
    # Convert BGR to RGB
    img = cv2.cvtColor(img, cv2.COLOR_BGR2RGB)
    # Convert to float32
    img = img.astype(np.float32)
    # Expand dims for batch
    img = np.expand_dims(img, axis=0)
    # MobileNetV2 preprocessing
    img = preprocess_input(img)
    return img


def extract_cnn_features(image_url):
    """Extract 1280D CNN feature vector from image"""
    try:
        # Download image
        img = download_image(image_url)
        
        # Preprocess
        processed = preprocess_for_cnn(img)
        
        # Extract features
        features = feature_extractor.predict(processed, verbose=0)
        
        # Flatten to 1D array (1280D)
        feature_vector = features.flatten().tolist()
        
        # Simple product type detection based on dominant colors/shapes
        product_type = detect_product_type(img)
        
        return {
            'features': feature_vector,
            'product_type': product_type,
            'feature_dim': len(feature_vector)
        }
    except Exception as e:
        raise Exception(f"CNN feature extraction failed: {str(e)}")


def detect_product_type(img):
    """Simple heuristic product type detection"""
    try:
        # Resize for faster processing
        small = cv2.resize(img, (64, 64))
        hsv = cv2.cvtColor(small, cv2.COLOR_BGR2HSV)
        
        # Calculate color statistics
        h_mean = np.mean(hsv[:, :, 0])
        s_mean = np.mean(hsv[:, :, 1])
        v_mean = np.mean(hsv[:, :, 2])
        
        # Simple heuristics
        if s_mean < 30:
            return 'electronics'  # Low saturation - likely electronics
        elif h_mean < 20 or h_mean > 160:
            return 'clothing'  # Red/pink tones - clothing
        elif 35 < h_mean < 85:
            return 'home_garden'  # Green tones - plants/garden
        else:
            return 'general'
    except:
        return 'unknown'


def sift_match(image1_url, image2_url):
    """SIFT keypoint matching with Lowe's ratio test"""
    try:
        # Download both images
        img1 = download_image(image1_url)
        img2 = download_image(image2_url)
        
        # Resize to standard size for speed (640x480)
        img1 = cv2.resize(img1, (640, 480))
        img2 = cv2.resize(img2, (640, 480))
        
        # Convert to grayscale
        gray1 = cv2.cvtColor(img1, cv2.COLOR_BGR2GRAY)
        gray2 = cv2.cvtColor(img2, cv2.COLOR_BGR2GRAY)
        
        # Initialize SIFT detector
        sift = cv2.SIFT_create(nfeatures=1000)
        
        # Detect keypoints and descriptors
        kp1, des1 = sift.detectAndCompute(gray1, None)
        kp2, des2 = sift.detectAndCompute(gray2, None)
        
        if des1 is None or des2 is None:
            return {
                'match_score': 0.0,
                'keypoint_count': 0,
                'good_matches': 0
            }
        
        # BFMatcher with L2 norm
        bf = cv2.BFMatcher(cv2.NORM_L2, crossCheck=False)
        
        # KNN matching
        matches = bf.knnMatch(des1, des2, k=2)
        
        # Lowe's ratio test (0.75)
        good_matches = []
        for m, n in matches:
            if m.distance < 0.75 * n.distance:
                good_matches.append(m)
        
        # Calculate match score
        total_keypoints = min(len(kp1), len(kp2))
        if total_keypoints == 0:
            match_score = 0.0
        else:
            match_score = len(good_matches) / total_keypoints
        
        return {
            'match_score': float(match_score),
            'keypoint_count': int(total_keypoints),
            'good_matches': len(good_matches)
        }
    except Exception as e:
        raise Exception(f"SIFT matching failed: {str(e)}")


@app.route('/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'service': 'ml-service',
        'model_loaded': feature_extractor is not None
    })


@app.route('/extract-cnn', methods=['POST'])
def extract_cnn_endpoint():
    """Extract CNN features from image URL"""
    start_time = cv2.getTickCount()
    
    try:
        data = request.get_json()
        if not data or 'imageUrl' not in data:
            return jsonify({'error': 'imageUrl is required'}), 400
        
        image_url = data['imageUrl']
        result = extract_cnn_features(image_url)
        
        elapsed = (cv2.getTickCount() - start_time) / cv2.getTickFrequency()
        result['processing_time_ms'] = round(elapsed * 1000, 2)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({
            'error': str(e),
            'features': [],
            'product_type': 'unknown',
            'feature_dim': 0,
            'processing_time_ms': 0
        }), 500


@app.route('/verify-sift', methods=['POST'])
def verify_sift_endpoint():
    """Verify image match using SIFT keypoints"""
    start_time = cv2.getTickCount()
    
    try:
        data = request.get_json()
        if not data or 'newImageUrl' not in data or 'candidateImageUrl' not in data:
            return jsonify({'error': 'newImageUrl and candidateImageUrl are required'}), 400
        
        new_image_url = data['newImageUrl']
        candidate_image_url = data['candidateImageUrl']
        
        result = sift_match(new_image_url, candidate_image_url)
        
        elapsed = (cv2.getTickCount() - start_time) / cv2.getTickFrequency()
        result['processing_time_ms'] = round(elapsed * 1000, 2)
        
        return jsonify(result)
    
    except Exception as e:
        return jsonify({
            'error': str(e),
            'match_score': 0.0,
            'keypoint_count': 0,
            'good_matches': 0,
            'processing_time_ms': 0
        }), 500


@app.route('/batch-extract-cnn', methods=['POST'])
def batch_extract_cnn():
    """Extract CNN features from multiple images"""
    try:
        data = request.get_json()
        if not data or 'imageUrls' not in data:
            return jsonify({'error': 'imageUrls array is required'}), 400
        
        image_urls = data['imageUrls']
        if not isinstance(image_urls, list):
            return jsonify({'error': 'imageUrls must be an array'}), 400
        
        results = []
        for url in image_urls:
            try:
                result = extract_cnn_features(url)
                result['imageUrl'] = url
                results.append(result)
            except Exception as e:
                results.append({
                    'imageUrl': url,
                    'error': str(e),
                    'features': [],
                    'product_type': 'unknown',
                    'feature_dim': 0
                })
        
        return jsonify({'results': results})
    
    except Exception as e:
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    # Initialize model on startup
    print("[ML Service] Starting up...")
    initialize_model()
    
    # Run Flask app
    port = int(os.environ.get('PORT', 5000))
    app.run(host='0.0.0.0', port=port, threaded=False)
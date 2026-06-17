import CoreLocation
import Foundation

final class LyraLocationDelegate: NSObject, CLLocationManagerDelegate {
  private(set) var location: CLLocation?
  private(set) var failure: Error?
  private(set) var finished = false

  func reset() {
    location = nil
    failure = nil
    finished = false
  }

  func waitForUpdates(manager: CLLocationManager, timeoutSeconds: TimeInterval) throws -> CLLocation {
    reset()
    manager.startUpdatingLocation()
    let deadline = Date().addingTimeInterval(timeoutSeconds)
    while finished == false && Date() < deadline {
      RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
    }
    manager.stopUpdatingLocation()
    if let failure {
      throw failure
    }
    guard let location else {
      throw NSError(
        domain: "LyraLocation",
        code: 2,
        userInfo: [NSLocalizedDescriptionKey: "no location available"]
      )
    }
    return location
  }

  func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard let latest = locations.last else {
      return
    }
    location = latest
    finished = true
  }

  func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    let nsError = error as NSError
    if nsError.domain == kCLErrorDomain && nsError.code == CLError.locationUnknown.rawValue {
      return
    }
    failure = error
    finished = true
  }
}

let manager = CLLocationManager()
let delegate = LyraLocationDelegate()
manager.delegate = delegate
manager.desiredAccuracy = kCLLocationAccuracyBest

let initialStatus: CLAuthorizationStatus
if #available(macOS 11.0, *) {
  initialStatus = manager.authorizationStatus
} else {
  initialStatus = CLLocationManager.authorizationStatus()
}

if initialStatus == .denied || initialStatus == .restricted {
  fputs("{\"error\":\"location permission denied\"}\n", stderr)
  exit(1)
}

if initialStatus == .notDetermined {
  manager.requestWhenInUseAuthorization()
  let authDeadline = Date().addingTimeInterval(5.0)
  while Date() < authDeadline {
    let status: CLAuthorizationStatus
    if #available(macOS 11.0, *) {
      status = manager.authorizationStatus
    } else {
      status = CLLocationManager.authorizationStatus()
    }
    if status != .notDetermined {
      break
    }
    RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.1))
  }
}

let resolvedStatus: CLAuthorizationStatus
if #available(macOS 11.0, *) {
  resolvedStatus = manager.authorizationStatus
} else {
  resolvedStatus = CLLocationManager.authorizationStatus()
}

if resolvedStatus == .denied || resolvedStatus == .restricted {
  fputs("{\"error\":\"location permission denied\"}\n", stderr)
  exit(1)
}

do {
  let location = try delegate.waitForUpdates(manager: manager, timeoutSeconds: 10)
  let payload: [String: Any] = [
    "latitude": location.coordinate.latitude,
    "longitude": location.coordinate.longitude,
    "accuracyMeters": location.horizontalAccuracy
  ]
  let data = try JSONSerialization.data(withJSONObject: payload)
  guard let json = String(data: data, encoding: .utf8) else {
    fputs("{\"error\":\"failed to encode location\"}\n", stderr)
    exit(1)
  }
  print(json)
} catch {
  let nsError = error as NSError
  if nsError.domain == kCLErrorDomain && nsError.code == CLError.denied.rawValue {
    fputs("{\"error\":\"location permission denied\"}\n", stderr)
    exit(1)
  }
  let payload = ["error": error.localizedDescription]
  if let data = try? JSONSerialization.data(withJSONObject: payload),
     let json = String(data: data, encoding: .utf8) {
    fputs(json + "\n", stderr)
  }
  exit(1)
}
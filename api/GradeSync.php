<?php
/**
 * Grade Synchronization Helper
 * Syncs between users.grades_data (JSON) and the granular grades table
 */
class GradeSync {
    public static function syncJsonToTable(PDO $pdo, int $userId, string $jsonGrades, string $schoolYear): void {
        try {
            $data = json_decode($jsonGrades, true);
            if (!is_array($data)) return;

            // Delete existing records for this user/year to ensure synchronization
            $pdo->prepare("DELETE FROM grades WHERE user_id = ? AND school_year = ?")->execute([$userId, $schoolYear]);

            // Subjects mapping from frontend (hardcoded for now to match js/features/grades.js)
            $subjects = [
                "Mathematics", "English", "Science", "Filipino", "Araling Panlipunan",
                "MAPEH", "Computer", "Christian Living"
            ];

            foreach ($data as $quarter => $quarterGrades) {
                if (!is_numeric($quarter) || !is_array($quarterGrades)) continue;

                foreach ($quarterGrades as $index => $g) {
                    if (!isset($g['ww']) || !isset($g['pt']) || !isset($g['qa'])) continue;

                    $ww = floatval($g['ww']);
                    $pt = floatval($g['pt']);
                    $qa = floatval($g['qa']);

                    // Standard DepEd Weights: Written 25%, Perf Task 50%, Quarterly Assess 25%
                    $finalGrade = round(($ww * 0.25) + ($pt * 0.50) + ($qa * 0.25));

                    $subjectName = $subjects[$index] ?? ("Subject " . ($index + 1));
                    $subjectName .= " (Q$quarter)";

                    $stmt = $pdo->prepare("
                        INSERT INTO grades (user_id, subject, grade, created_at, school_year)
                        VALUES (?, ?, ?, datetime('now', 'localtime'), ?)
                    ");
                    $stmt->execute([$userId, $subjectName, $finalGrade, $schoolYear]);
                }
            }
        } catch (Exception $e) {
            error_log("GradeSync error: " . $e->getMessage());
        }
    }
}
